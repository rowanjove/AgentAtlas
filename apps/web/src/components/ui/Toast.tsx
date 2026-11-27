import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { IconButton } from './Button';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastState {
  items: ToastItem[];
  push: (item: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (item) => {
    const id = `toast-${++seq}`;
    set((s) => ({ items: [...s.items.slice(-3), { ...item, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (title: string, description?: string) => useToastStore.getState().push({ tone: 'info', title, description, durationMs: 3600 }),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: 'success', title, description, durationMs: 3600 }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: 'warning', title, description, durationMs: 4800 }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ tone: 'error', title, description, durationMs: 6000 }),
};

const TONE_META: Record<ToastTone, { color: string; Icon: typeof Info }> = {
  info: { color: 'var(--info)', Icon: Info },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  error: { color: 'var(--error)', Icon: XCircle },
};

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const { color, Icon } = TONE_META[item.tone];

  useEffect(() => {
    if (paused) return;
    const ms = item.durationMs ?? 4000;
    if (ms <= 0) return;
    const timer = setTimeout(() => onDismiss(item.id), ms);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, onDismiss, paused]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-2.5 w-[340px] max-w-[92vw] px-3.5 py-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-md)]"
      style={{ borderLeftWidth: '3px', borderLeftColor: color }}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color }} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text)] leading-snug">{item.title}</div>
        {item.description && <div className="text-[13px] text-[var(--text-sec)] mt-0.5 leading-snug">{item.description}</div>}
      </div>
      <IconButton aria-label="关闭通知" size="xs" onClick={() => onDismiss(item.id)}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      role="region"
      aria-label="系统通知"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none"
    >
      {items.map((item) => (
        <ToastRow key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}
