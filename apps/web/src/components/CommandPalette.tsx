import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowRight,
  BookOpen,
  FlaskConical,
  Compass,
  Sun,
  Moon,
  Boxes,
  Briefcase,
} from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { StatusBadge } from './StatusBadge';
import { ProgressStatus } from '@agent-atlas/shared';

interface SearchItem {
  id: string;
  title: string;
  enTitle: string;
  domain: string;
  summary: string;
  status: ProgressStatus;
  snippet: string;
}

export function CommandPalette() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const setTheme = useAppStore((s) => s.setTheme);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useAppStore.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 10);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      apiGet<{ items: SearchItem[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=12`)
        .then((res) => {
          setResults(res.items);
          setSelectedIdx(0);
        })
        .catch(() => {});
    }, 70);
    return () => clearTimeout(handle);
  }, [query, open]);

  const jumpTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const switchTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    apiMutate('PUT', '/api/settings', { theme: next }).catch(() => {});
    setOpen(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cmd-palette-title"
      style={{ maxWidth: 'min(620px, 94vw)' }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        setOpen(false);
      }}
      onClick={(e) => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          setOpen(false);
        }
      }}
    >
      <div className="flex flex-col bg-[var(--panel)] text-[var(--text)]">
        <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-[var(--border)]">
          <Search className="h-4 w-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <h1 id="cmd-palette-title" className="sr-only">
            全局知识与功能检索
          </h1>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && results[selectedIdx]) {
                e.preventDefault();
                jumpTo(`/library/${encodeURIComponent(results[selectedIdx].id)}`);
              }
            }}
            placeholder="搜索知识节点、中英文术语（如 Agent Loop、循环、MCP、检查点）..."
            className="w-full bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="text-xs font-mono px-1.5 py-0.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel-sec)] text-[var(--text-sec)] shrink-0">
            Esc
          </kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto divide-y divide-[var(--border)]">
          {results.length === 0 ? (
            <div className="py-8 px-4 text-center text-[13px] text-[var(--text-sec)]">
              未找到直接匹配的知识条目，请尝试简化关键词。
            </div>
          ) : (
            results.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jumpTo(`/library/${encodeURIComponent(item.id)}`)}
                className={`w-full text-left px-3.5 py-2.5 flex items-start justify-between gap-3 cursor-pointer transition-colors duration-[var(--duration-instant)] ${
                  idx === selectedIdx ? 'bg-[var(--selected-bg)]' : 'hover:bg-[var(--panel-hover)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BookOpen
                      className={`h-3.5 w-3.5 shrink-0 ${
                        idx === selectedIdx ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'
                      }`}
                    />
                    <span className="text-sm font-medium truncate">{item.title}</span>
                    <span className="text-xs text-[var(--text-sec)] font-mono truncate">{item.id}</span>
                  </div>
                  <p className="text-[13px] text-[var(--text-sec)] mt-0.5 line-clamp-1 pl-5.5">{item.summary}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2 pt-0.5">
                  <StatusBadge status={item.status} compact />
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[var(--border)] bg-[var(--panel-sec)] text-xs text-[var(--text-sec)]">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => jumpTo('/learn')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
            >
              <Compass className="h-3.5 w-3.5" /> 学习路线
            </button>
            <button
              type="button"
              onClick={() => jumpTo('/lab')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
            >
              <FlaskConical className="h-3.5 w-3.5" /> 实验室
            </button>
            <button
              type="button"
              onClick={() => jumpTo('/ecosystem')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
            >
              <Boxes className="h-3.5 w-3.5" /> 工具对比
            </button>
            <button
              type="button"
              onClick={() => jumpTo('/casebook')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
            >
              <Briefcase className="h-3.5 w-3.5" /> 实战案例
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => switchTheme('light')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
              title="切换浅色主题"
            >
              <Sun className="h-3 w-3" /> 浅色
            </button>
            <button
              type="button"
              onClick={() => switchTheme('dark')}
              className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer"
              title="切换深色主题"
            >
              <Moon className="h-3 w-3" /> 深色
            </button>
            <span className="hidden sm:inline text-[var(--text-muted)]">· ↑↓ / Enter</span>
          </div>
        </div>
      </div>
    </dialog>
  );
}
