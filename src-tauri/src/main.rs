#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
struct JobGuard(HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for JobGuard {}
#[cfg(target_os = "windows")]
unsafe impl Sync for JobGuard {}

#[cfg(target_os = "windows")]
impl Drop for JobGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn attach_kill_on_close_job(child: &Child) -> Option<JobGuard> {
    unsafe {
        let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .is_err()
        {
            let _ = CloseHandle(job);
            return None;
        }
        let proc_handle = HANDLE(child.as_raw_handle());
        if AssignProcessToJobObject(job, proc_handle).is_err() {
            let _ = CloseHandle(job);
            return None;
        }
        Some(JobGuard(job))
    }
}

fn report_fatal_error(title: &str, message: &str) {
    eprintln!("{title}: {message}");
    let log_dir = std::env::var_os("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("AgentAtlas"))
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        });
    if let Some(dir) = log_dir {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("startup.err.log"), format!("{title}\n{message}\n"));
    }
    #[cfg(target_os = "windows")]
    {
        let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let msg_w: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            MessageBoxW(
                None,
                windows::core::PCWSTR(msg_w.as_ptr()),
                windows::core::PCWSTR(title_w.as_ptr()),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}

struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    #[cfg(target_os = "windows")]
    _job: Mutex<Option<JobGuard>>,
}

impl SidecarState {
    fn shutdown(&self) {
        if let Ok(mut stdin_guard) = self.stdin.lock() {
            drop(stdin_guard.take());
        }
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut exited = false;
                while Instant::now() < deadline {
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            exited = true;
                            break;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => break,
                    }
                }
                if !exited {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct RuntimePaths {
    node_exe: PathBuf,
    server_entry: PathBuf,
    web_dist: PathBuf,
    content_dir: PathBuf,
    data_dir: PathBuf,
}

fn is_dir_writable(dir: &Path) -> bool {
    let probe = dir.join(".atlas_write_probe");
    match OpenOptions::new().create(true).write(true).truncate(true).open(&probe) {
        Ok(mut f) => {
            let ok = f.write_all(b"1").is_ok();
            drop(f);
            let _ = fs::remove_file(&probe);
            ok
        }
        Err(_) => false,
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn sync_missing_files_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            sync_missing_files_recursive(&from, &to)?;
        } else if file_type.is_file() && !to.exists() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn resolve_runtime_paths() -> Result<RuntimePaths, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {e}"))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Executable has no parent directory".to_string())?
        .to_path_buf();

    // 1. Portable distribution layout: <exe_dir>/runtime/{node.exe, server.cjs}, web/, content/
    let portable_node = exe_dir.join("runtime").join("node.exe");
    let portable_server = exe_dir.join("runtime").join("server.cjs");
    let portable_web = exe_dir.join("web");
    let portable_content = exe_dir.join("content");

    if portable_node.is_file() && portable_server.is_file() && portable_web.is_dir() && portable_content.is_dir() {
        let (data_dir, content_dir) = if is_dir_writable(&exe_dir) && is_dir_writable(&portable_content) {
            (exe_dir.join("data"), portable_content)
        } else {
            let app_version = env!("CARGO_PKG_VERSION");
            let local_app_data = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("AgentAtlas");
            fs::create_dir_all(&local_app_data)
                .map_err(|e| format!("Failed to create local app data dir: {e}"))?;
            let writable_content = local_app_data.join("content");
            let version_marker = writable_content.join(".bundle-version");

            if !writable_content.exists() {
                let stage_dir = local_app_data.join(format!("content.tmp-{}", std::process::id()));
                if stage_dir.exists() {
                    let _ = fs::remove_dir_all(&stage_dir);
                }
                copy_dir_recursive(&portable_content, &stage_dir)
                    .map_err(|e| format!("Failed to stage writable content dir: {e}"))?;
                fs::write(stage_dir.join(".bundle-version"), app_version)
                    .map_err(|e| format!("Failed to write content version marker: {e}"))?;
                fs::rename(&stage_dir, &writable_content)
                    .map_err(|e| format!("Failed to finalize writable content dir: {e}"))?;
            } else {
                let existing_ver = fs::read_to_string(&version_marker).unwrap_or_default();
                if existing_ver.trim() != app_version {
                    sync_missing_files_recursive(&portable_content, &writable_content)
                        .map_err(|e| format!("Failed to sync upgraded content files: {e}"))?;
                    let _ = fs::write(&version_marker, app_version);
                }
            }
            (local_app_data.join("data"), writable_content)
        };

        fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
        return Ok(RuntimePaths {
            node_exe: portable_node,
            server_entry: portable_server,
            web_dist: portable_web,
            content_dir,
            data_dir,
        });
    }

    // 2. Fallback for local Cargo run inside repository
    let mut probe = exe_dir.as_path();
    for _ in 0..6 {
        let srv = probe.join("apps").join("server").join("dist").join("index.js");
        let web = probe.join("apps").join("web").join("dist");
        let cnt = probe.join("content");
        if srv.is_file() && web.is_dir() && cnt.is_dir() {
            let data_dir = probe.join("data").join("tauri-dev");
            fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create dev data dir: {e}"))?;
            return Ok(RuntimePaths {
                node_exe: PathBuf::from("node"),
                server_entry: srv,
                web_dist: web,
                content_dir: cnt,
                data_dir,
            });
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => break,
        }
    }

    Err(format!(
        "Cannot locate AgentAtlas runtime files near {}",
        exe_dir.display()
    ))
}

fn pick_free_port() -> Result<u16, String> {
    for port in 4317..=4327 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener.local_addr().map(|a| a.port()).unwrap_or(port));
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind ephemeral port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local port: {e}"))?
        .port();
    Ok(port)
}

fn wait_for_health(port: u16, child: &mut Child, err_log_path: &Path) -> Result<(), String> {
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("Invalid socket addr: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(15);

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            let err_tail = fs::read_to_string(err_log_path).unwrap_or_default();
            return Err(format!(
                "Local server exited prematurely ({status}).\n{err_tail}"
            ));
        }

        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
            let req = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 512];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = String::from_utf8_lossy(&buf[..n]);
                    if resp.starts_with("HTTP/1.1 200") || resp.starts_with("HTTP/1.0 200") {
                        return Ok(());
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    Err(format!("Timed out waiting for AgentAtlas backend on port {port}"))
}

fn spawn_sidecar(paths: &RuntimePaths, port: u16) -> Result<(Child, Option<ChildStdin>), String> {
    let log_path = paths.data_dir.join("server.log");
    let err_log_path = paths.data_dir.join("server.err.log");
    let out_file = File::create(&log_path).map_err(|e| format!("Cannot create server.log: {e}"))?;
    let err_file = File::create(&err_log_path).map_err(|e| format!("Cannot create server.err.log: {e}"))?;

    let mut cmd = Command::new(&paths.node_exe);
    cmd.arg("--no-warnings=ExperimentalWarning")
        .arg(&paths.server_entry)
        .env("AGENT_ATLAS_PORT", port.to_string())
        .env("AGENT_ATLAS_CONTENT_DIR", &paths.content_dir)
        .env("AGENT_ATLAS_DATA_DIR", &paths.data_dir)
        .env("AGENT_ATLAS_WEB_DIST", &paths.web_dist)
        .env("AGENT_ATLAS_PARENT_PIPE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file));

    if let Some(parent) = paths.server_entry.parent() {
        cmd.current_dir(parent);
    }

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn node sidecar: {e}"))?;
    let stdin = child.stdin.take();
    if let Err(e) = wait_for_health(port, &mut child, &err_log_path) {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }
    Ok((child, stdin))
}

fn is_local_workbench_url(url: &Url, port: u16) -> bool {
    matches!(url.scheme(), "http")
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(port)
}

fn is_local_workbench_blob(url: &Url, port: u16) -> bool {
    url.scheme() == "blob"
        && url
            .as_str()
            .starts_with(&format!("blob:http://127.0.0.1:{port}/"))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn main() {
    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .setup(move |app| {
            let runtime_paths = match resolve_runtime_paths() {
                Ok(p) => p,
                Err(err) => {
                    report_fatal_error("AgentAtlas 启动失败", &err);
                    std::process::exit(1);
                }
            };

            let port = match pick_free_port() {
                Ok(p) => p,
                Err(err) => {
                    report_fatal_error("AgentAtlas 启动失败", &err);
                    std::process::exit(1);
                }
            };

            let (child, stdin) = match spawn_sidecar(&runtime_paths, port) {
                Ok(pair) => pair,
                Err(err) => {
                    report_fatal_error(
                        "AgentAtlas 本地服务启动失败",
                        &format!("{err}\n\n请检查数据目录下的 server.err.log。"),
                    );
                    std::process::exit(1);
                }
            };

            #[cfg(target_os = "windows")]
            let job_guard = attach_kill_on_close_job(&child);

            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                stdin: Mutex::new(stdin),
                #[cfg(target_os = "windows")]
                _job: Mutex::new(job_guard),
            });

            let webview_data_dir = runtime_paths.data_dir.join("webview2");
            let _ = fs::create_dir_all(&webview_data_dir);
            let local_url = Url::parse(&format!("http://127.0.0.1:{port}/")).expect("valid loopback url");

            let nav_handle = app.handle().clone();
            let win_handle = app.handle().clone();

            let mut win_builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(local_url),
            )
            .title("AgentAtlas · AI Agent Engineering Workbench")
            .inner_size(1366.0, 820.0)
            .min_inner_size(1024.0, 680.0)
            .center()
            .data_directory(webview_data_dir)
            .on_navigation(move |nav_url| {
                if is_local_workbench_url(nav_url, port) || is_local_workbench_blob(nav_url, port) {
                    return true;
                }
                if matches!(nav_url.scheme(), "http" | "https") {
                    let _ = nav_handle.opener().open_url(nav_url.as_str(), None::<&str>);
                    return false;
                }
                false
            })
            .on_new_window(move |req_url, _features| {
                if is_local_workbench_url(&req_url, port) {
                    if let Some(win) = win_handle.get_webview_window("main") {
                        let _ = win.navigate(req_url);
                    }
                } else if matches!(req_url.scheme(), "http" | "https") {
                    let _ = win_handle.opener().open_url(req_url.as_str(), None::<&str>);
                }
                NewWindowResponse::Deny
            });

            if let Some(icon) = app.default_window_icon() {
                win_builder = win_builder.icon(icon.clone())?;
            }
            win_builder.build()?;

            // Native Tray Icon
            let show_item = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出 AgentAtlas").build(app)?;
            let tray_menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("AgentAtlas · Local Workbench")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            report_fatal_error(
                "AgentAtlas 桌面窗口初始化失败",
                &format!("无法初始化桌面窗口（请确认系统已安装 Microsoft Edge WebView2 Runtime）。\n\n详情：{err}"),
            );
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                state.shutdown();
            }
            app_handle.exit(0);
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                state.shutdown();
            }
        }
        _ => {}
    });
}
