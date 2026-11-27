import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Map as MapIcon,
  BookOpen,
  FlaskConical,
  Boxes,
  Briefcase,
  UserCheck,
  FolderCog,
  Sparkles,
  Settings,
  Search,
  Sun,
  Moon,
  Monitor,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { CommandPalette } from './CommandPalette';
import { ErrorBoundary } from './ErrorBoundary';
import { BrandMark, Breadcrumb, Button, IconButton, type BreadcrumbItem } from './ui';

const TutorPanel = lazy(() => import('./TutorPanel').then((m) => ({ default: m.TutorPanel })));

const PRIMARY_GROUPS = [
  {
    title: '学习与阅读',
    items: [
      { to: '/', label: '首页', icon: LayoutDashboard, end: true },
      { to: '/learn', label: '学习路线', icon: MapIcon },
      { to: '/library', label: '知识百科', icon: BookOpen },
      { to: '/lab', label: '互动实验', icon: FlaskConical },
    ],
  },
  {
    title: '工程研究',
    items: [
      { to: '/casebook', label: '实战案例', icon: Briefcase },
      { to: '/ecosystem', label: '工具对比', icon: Boxes },
      { to: '/tutor', label: 'AI 导师', icon: Sparkles },
    ],
  },
  {
    title: '资产与记录',
    items: [
      { to: '/my-learning', label: '我的记录', icon: UserCheck },
      { to: '/content', label: '内容管理', icon: FolderCog },
    ],
  },
];

function deriveDefaultBreadcrumb(pathname: string): BreadcrumbItem[] {
  if (pathname === '/') return [{ label: '首页' }];
  if (pathname.startsWith('/learn')) return [{ label: '学习路线', to: '/learn' }];
  if (pathname === '/library/graph') {
    return [{ label: '知识百科', to: '/library' }, { label: '全局图谱' }];
  }
  if (pathname.startsWith('/library')) return [{ label: '知识百科', to: '/library' }];
  if (pathname.startsWith('/lab')) return [{ label: '互动实验', to: '/lab' }];
  if (pathname.startsWith('/casebook')) return [{ label: '实战案例', to: '/casebook' }];
  if (pathname.startsWith('/ecosystem')) return [{ label: '工具对比' }];
  if (pathname.startsWith('/tutor')) return [{ label: 'AI 导师' }];
  if (pathname.startsWith('/my-learning')) return [{ label: '我的记录' }];
  if (pathname.startsWith('/content')) return [{ label: '内容管理' }];
  if (pathname.startsWith('/settings')) return [{ label: '设置' }];
  return [{ label: 'AgentAtlas' }];
}

export function AppShell() {
  const location = useLocation();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const pageBreadcrumb = useAppStore((s) => s.pageBreadcrumb);
  const setPageBreadcrumb = useAppStore((s) => s.setPageBreadcrumb);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const tutorOpen = useAppStore((s) => s.tutorOpen);
  const setTutorOpen = useAppStore((s) => s.setTutorOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setPageBreadcrumb(null);
  }, [location.pathname, setPageBreadcrumb]);

  const cycleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    apiMutate('PUT', '/api/settings', { theme: next }).catch(() => {});
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeLabel = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统';
  const breadcrumbItems = pageBreadcrumb && pageBreadcrumb.length > 0 ? pageBreadcrumb : deriveDefaultBreadcrumb(location.pathname);

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {/* Left Navigation Rail */}
      <nav
        aria-label="主导航"
        className={`${
          mobileMenuOpen ? 'fixed inset-y-0 left-0 z-[var(--z-modal)] shadow-[var(--shadow-lg)]' : 'hidden lg:flex'
        } ${
          sidebarCollapsed ? 'lg:w-[56px]' : 'w-[212px]'
        } shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-out)] select-none`}
      >
        {/* Brand Header */}
        <div
          className={`h-12 shrink-0 border-b border-[var(--border)] flex items-center ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
          }`}
        >
          {!sidebarCollapsed && (
            <NavLink
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 min-w-0 font-semibold text-[13.5px] tracking-tight text-[var(--text)]"
            >
              <BrandMark size={24} />
              <span className="truncate">AgentAtlas</span>
            </NavLink>
          )}
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:inline-flex"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            title={sidebarCollapsed ? '展开左侧导航' : '收起左侧导航'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </IconButton>
          {mobileMenuOpen && (
            <IconButton
              size="xs"
              variant="ghost"
              className="lg:hidden"
              aria-label="关闭导航菜单"
              onClick={() => setMobileMenuOpen(false)}
            >
              <PanelLeftClose className="h-4 w-4" />
            </IconButton>
          )}
        </div>

        {/* Navigation Groups */}
        <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-4">
          {PRIMARY_GROUPS.map((group) => (
            <div key={group.title} className="space-y-0.5">
              {!sidebarCollapsed && (
                <div className="px-3.5 pb-1 text-xs font-medium text-[var(--text-sec)] tracking-wide">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileMenuOpen(false)}
                    title={item.label}
                    className={({ isActive }) =>
                      `relative mx-2 px-2.5 h-9 rounded-[var(--radius-sm)] flex items-center gap-2.5 text-sm transition-colors duration-[var(--duration-fast)] ${
                        sidebarCollapsed ? 'justify-center px-0' : ''
                      } ${
                        isActive
                          ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                          : 'text-[var(--text-sec)] hover:text-[var(--text)] hover:bg-[var(--panel-sec)]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !sidebarCollapsed && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[var(--primary)]"
                          />
                        )}
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom Utility Anchor */}
        <div className="shrink-0 border-t border-[var(--border)] p-2 space-y-0.5">
          <NavLink
            to="/settings"
            onClick={() => setMobileMenuOpen(false)}
            title="设置"
            className={({ isActive }) =>
              `relative px-2.5 h-9 rounded-[var(--radius-sm)] flex items-center gap-2.5 text-sm transition-colors duration-[var(--duration-fast)] ${
                sidebarCollapsed ? 'justify-center px-0' : ''
              } ${
                isActive
                  ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                  : 'text-[var(--text-sec)] hover:text-[var(--text)] hover:bg-[var(--panel-sec)]'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {!sidebarCollapsed && <span className="truncate">设置</span>}
          </NavLink>

          <button
            type="button"
            onClick={cycleTheme}
            title={`外观主题：${themeLabel}（点击切换）`}
            className={`w-full px-2.5 h-9 rounded-[var(--radius-sm)] flex items-center gap-2.5 text-sm text-[var(--text-sec)] hover:text-[var(--text)] hover:bg-[var(--panel-sec)] transition-colors duration-[var(--duration-fast)] cursor-pointer ${
              sidebarCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            <ThemeIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {!sidebarCollapsed && (
              <span className="flex-1 text-left truncate flex items-center justify-between">
                <span>主题</span>
                <span className="text-xs text-[var(--text-sec)]">{themeLabel}</span>
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[calc(var(--z-modal)-1)] bg-black/35 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Right Column: Context Top Toolbar + Workspace */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-12 shrink-0 border-b border-[var(--border)] bg-[var(--panel)] px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconButton
              size="xs"
              variant="outline"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden"
              aria-label="切换导航菜单"
            >
              <Menu className="h-4 w-4" />
            </IconButton>
            <Breadcrumb items={breadcrumbItems} />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="h-8 w-52 sm:w-64 md:w-72 flex items-center justify-between gap-2 px-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-strong)] text-[13px] text-[var(--text-sec)] transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 truncate">
                <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                <span className="truncate">搜索概念、术语或实验...</span>
              </span>
              <kbd className="hidden sm:inline font-mono text-xs px-1.5 py-0.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] text-[var(--text-sec)]">
                Ctrl+K
              </kbd>
            </button>

            {location.pathname !== '/tutor' && (
              <Button
                size="sm"
                variant="outline"
                active={tutorOpen}
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() => setTutorOpen(!tutorOpen)}
              >
                <span className="hidden sm:inline">AI 导师</span>
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          <main className="flex-1 min-w-0 overflow-y-auto">
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>

          {location.pathname !== '/tutor' && tutorOpen && (
            <Suspense fallback={null}>
              <TutorPanel />
            </Suspense>
          )}
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
