import { useEffect, useState } from 'react';
import { HardDriveDownload, RotateCcw, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { TutorConfig } from '@agent-atlas/shared';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore, ThemePreference } from '../store/useAppStore';
import { Badge, Button, ConfirmDialog, Input, Select, Skeleton, Switch, toast } from '../components/ui';

interface SettingsResponse {
  theme: ThemePreference;
  readerWidthPx: number;
  fontSizePx: number;
  reducedMotion: boolean;
  tutor: TutorConfig;
  paths: { contentDir: string; dataDir: string; dbPath: string };
}

interface BackupItem {
  backupId: string;
  createdAt: string;
  files: Array<{ relativePath: string; size: number }>;
}

export function SettingsPage() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setReaderPrefs = useAppStore((s) => s.setReaderPrefs);
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion);

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyStorage, setKeyStorage] = useState<'memory' | 'dpapi'>('dpapi');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [clearKeyOpen, setClearKeyOpen] = useState(false);

  const loadAll = () => {
    apiGet<SettingsResponse>('/api/settings')
      .then((s) => {
        setSettings(s);
        setKeyStorage(s.tutor.keyStorage);
      })
      .catch((e) => toast.error('加载设置失败', e instanceof Error ? e.message : '未知错误'));
    apiGet<{ backups: BackupItem[] }>('/api/backup/list')
      .then((b) => setBackups(b.backups))
      .catch((e) => toast.error('加载备份列表失败', e instanceof Error ? e.message : '未知错误'));
  };

  useEffect(() => {
    loadAll();
  }, []);

  if (!settings) {
    return (
      <div className="max-w-[920px] mx-auto px-6 py-7 space-y-5">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  const saveAppearance = async (patch: Partial<SettingsResponse>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.theme) setTheme(patch.theme);
    setReaderPrefs({
      readerWidthPx: next.readerWidthPx,
      fontSizePx: next.fontSizePx,
      reducedMotion: next.reducedMotion,
    });
    try {
      await apiMutate('PUT', '/api/settings', {
        theme: next.theme,
        readerWidthPx: next.readerWidthPx,
        fontSizePx: next.fontSizePx,
        reducedMotion: next.reducedMotion,
      });
    } catch (e) {
      toast.error('保存外观偏好失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  const saveTutor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiMutate<{ ok: boolean; apiKeyClearedForNewOrigin?: boolean }>('PUT', '/api/settings', {
        tutor: {
          enabled: settings.tutor.enabled,
          baseUrl: settings.tutor.baseUrl,
          model: settings.tutor.model,
          timeoutMs: settings.tutor.timeoutMs,
          maxTokens: settings.tutor.maxTokens,
        },
      });
      if (res.apiKeyClearedForNewOrigin) {
        toast.warning('端点已保存，旧密钥已自动清除', 'Base URL 主机变更时系统会自动清理旧 API 密钥。');
        loadAll();
      } else {
        toast.success('AI 导师端点配置已保存');
      }
    } catch (e) {
      toast.error('保存端点配置失败', e instanceof Error ? e.message : '未知错误');
    }
  };

  return (
    <div className="max-w-[920px] mx-auto px-6 py-7 space-y-8 text-sm">
      <header className="pb-4 border-b border-[var(--border)]">
        <h1 className="text-xl font-semibold tracking-tight">偏好设置与本地数据管理</h1>
        <p className="text-[13px] text-[var(--text-sec)] mt-1">
          管理主题外观、阅读排版、一致性全量备份，以及可选的本地或兼容模型端点。
        </p>
      </header>

      {statusNotice && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--success)]/40 bg-[var(--success-bg)] px-3.5 py-2.5 text-[var(--success)] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Group 1: Appearance & Reading */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-5 pb-7 border-b border-[var(--border)]">
        <div className="md:col-span-4 space-y-1">
          <h2 className="text-base font-semibold">外观与排版</h2>
          <p className="text-[13px] text-[var(--text-sec)] leading-relaxed">
            浅色与深色主题独立校色，所有阅读偏好即时生效并持久化。
          </p>
        </div>

        <div className="md:col-span-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-[var(--text)] block">配色主题</span>
              <Select
                className="w-full"
                value={settings.theme}
                onChange={(e) => saveAppearance({ theme: e.target.value as ThemePreference })}
              >
                <option value="system">跟随系统 (System)</option>
                <option value="light">浅色 (#F7F8FA)</option>
                <option value="dark">深色 (#111317)</option>
              </Select>
            </label>

            <div className="flex items-end pb-1">
              <Switch
                checked={settings.reducedMotion}
                onChange={(checked) => saveAppearance({ reducedMotion: checked })}
                label="减少动效 (Reduced Motion)"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--border)]">
            <label className="block space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="font-medium text-[var(--text)]">阅读正文宽度</span>
                <span className="font-mono text-[var(--text-sec)]">{settings.readerWidthPx}px</span>
              </div>
              <input
                type="range"
                min={680}
                max={920}
                step={20}
                value={settings.readerWidthPx}
                onChange={(e) => saveAppearance({ readerWidthPx: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="block space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="font-medium text-[var(--text)]">正文字号</span>
                <span className="font-mono text-[var(--text-sec)]">{settings.fontSizePx}px</span>
              </div>
              <input
                type="range"
                min={14}
                max={19}
                step={1}
                value={settings.fontSizePx}
                onChange={(e) => saveAppearance({ fontSizePx: Number(e.target.value) })}
                className="w-full"
              />
            </label>
          </div>
        </div>
      </section>

      {/* Group 2: Local Storage & Consistent Backups */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-5 pb-7 border-b border-[var(--border)]">
        <div className="md:col-span-4 space-y-1">
          <h2 className="text-base font-semibold">本地存储与备份</h2>
          <p className="text-[13px] text-[var(--text-sec)] leading-relaxed">
            全量备份包含 `content/` 与 `SQLite VACUUM INTO` 快照及 SHA-256 校验清单，自动排除任何密钥。
          </p>
        </div>

        <div className="md:col-span-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-mono text-xs text-[var(--text-sec)] space-y-0.5 min-w-0">
              <div className="truncate">内容目录: {settings.paths.contentDir}</div>
              <div className="truncate">数据库: {settings.paths.dbPath}</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<HardDriveDownload className="h-3.5 w-3.5" />}
              onClick={async () => {
                try {
                  const b = await apiMutate<BackupItem>('POST', '/api/backup/create', { label: 'manual' });
                  const text = `已创建一致性备份 ${b.backupId}（含 content/ 与 SQLite 快照，已排除 API 密钥）`;
                  setStatusNotice(text);
                  toast.success('已创建一致性备份', b.backupId);
                  loadAll();
                } catch (e) {
                  toast.error('创建备份失败', e instanceof Error ? e.message : '未知错误');
                }
              }}
            >
              创建全量备份
            </Button>
          </div>

          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg)]">
            {backups.length === 0 ? (
              <div className="px-3.5 py-4 text-[var(--text-muted)]">尚无备份快照。</div>
            ) : (
              backups.map((b) => (
                <div key={b.backupId} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono font-medium text-[var(--text)]">{b.backupId}</span>
                    <span className="ml-2 text-[var(--text-muted)] font-mono">({b.files.length} 文件)</span>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    leftIcon={<RotateCcw className="h-3 w-3" />}
                    onClick={() => setRestoreTargetId(b.backupId)}
                  >
                    校验并恢复
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Group 3: Optional Model Endpoint & DPAPI Credential Vault */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <div className="md:col-span-4 space-y-1">
          <h2 className="text-base font-semibold">可选 AI 模型接口</h2>
          <p className="text-[13px] text-[var(--text-sec)] leading-relaxed">
            所有核心学习流程均不依赖外部模型。API Key 仅存进程内存或 Windows DPAPI 加密文件，绝不进入前端或 SQLite。
          </p>
        </div>

        <div className="md:col-span-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-5">
          <form onSubmit={saveTutor} className="space-y-4">
            <Switch
              checked={settings.tutor.enabled}
              onChange={(checked) => setSettings({ ...settings, tutor: { ...settings.tutor, enabled: checked } })}
              label="启用 OpenAI-compatible / LM Studio 端点（关闭时使用本地 FTS5 离线模式）"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[var(--text-sec)]">Base URL</span>
                <Input
                  className="font-mono"
                  value={settings.tutor.baseUrl}
                  onChange={(e) => setSettings({ ...settings, tutor: { ...settings.tutor, baseUrl: e.target.value } })}
                  placeholder="http://127.0.0.1:1234/v1"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[var(--text-sec)]">Model 名称</span>
                <Input
                  className="font-mono"
                  value={settings.tutor.model}
                  onChange={(e) => setSettings({ ...settings, tutor: { ...settings.tutor, model: e.target.value } })}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm">
                保存端点配置
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await apiMutate<{ ok: boolean; detail: string }>('POST', '/api/tutor/test-connection');
                    setTestResult(res);
                  } catch (e) {
                    setTestResult({ ok: false, detail: e instanceof Error ? e.message : '连接测试失败' });
                  }
                }}
              >
                测试连通性
              </Button>
            </div>

            {testResult && (
              <div className={`flex items-center gap-1.5 ${testResult.ok ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{testResult.detail}</span>
              </div>
            )}
          </form>

          <div className="border-t border-[var(--border)] pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium flex items-center gap-1.5 text-[var(--text)]">
                <KeyRound className="h-3.5 w-3.5 text-[var(--primary)]" />
                API 密钥凭据隔离管理
              </span>
              <Badge tone={settings.tutor.hasApiKey ? 'success' : 'neutral'}>
                {settings.tutor.hasApiKey ? `已配置 (${settings.tutor.keyStorage})` : '未配置'}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <Input
                  type="password"
                  className="font-mono"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="输入 sk-...（LM Studio 本地可留空）"
                />
              </div>
              <Select
                aria-label="密钥存储方式"
                value={keyStorage}
                onChange={(e) => setKeyStorage(e.target.value as 'memory' | 'dpapi')}
              >
                <option value="dpapi">Windows DPAPI 加密</option>
                <option value="memory">仅本进程内存</option>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={!apiKeyInput.trim()}
                onClick={async () => {
                  try {
                    await apiMutate('POST', '/api/settings/api-key', { apiKey: apiKeyInput, keyStorage });
                    setApiKeyInput('');
                    toast.success('API Key 已安全存储');
                    loadAll();
                  } catch (e) {
                    toast.error('保存 API Key 失败', e instanceof Error ? e.message : '未知错误');
                  }
                }}
              >
                保存 Key
              </Button>
              {settings.tutor.hasApiKey && (
                <Button variant="destructive" size="sm" onClick={() => setClearKeyOpen(true)}>
                  清除 Key
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(restoreTargetId)}
        onClose={() => setRestoreTargetId(null)}
        onConfirm={async () => {
          if (!restoreTargetId) return;
          try {
            await apiMutate('POST', '/api/backup/restore', { backupId: restoreTargetId });
            setStatusNotice(`已校验哈希并恢复至备份 ${restoreTargetId}（恢复前状态已自动另存备份）。`);
            toast.success('备份恢复完成', restoreTargetId);
            setRestoreTargetId(null);
            bumpDataVersion();
            loadAll();
          } catch (e) {
            toast.error('恢复备份失败', e instanceof Error ? e.message : '未知错误');
          }
        }}
        title="确认校验并恢复全量备份"
        message={`恢复备份 ${restoreTargetId} 将覆盖当前内容库与学习数据库（系统会在覆盖前自动保存一份安全快照）。确定继续？`}
        confirmLabel="校验并恢复"
        destructive
      />

      <ConfirmDialog
        open={clearKeyOpen}
        onClose={() => setClearKeyOpen(false)}
        onConfirm={async () => {
          try {
            await apiMutate('DELETE', '/api/settings/api-key');
            toast.info('API Key 已彻底清除');
            setClearKeyOpen(false);
            loadAll();
          } catch (e) {
            toast.error('清除 API Key 失败', e instanceof Error ? e.message : '未知错误');
          }
        }}
        title="清除已保存的 API Key"
        message="清除后将切换回本地 FTS5 离线引导模式，直到重新配置密钥。确定清除？"
        confirmLabel="清除"
        destructive
      />
    </div>
  );
}
