import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from './Button';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = '540px',
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const isOutside = (e: React.PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      style={{ maxWidth: `min(${maxWidth}, 94vw)` }}
      onClose={() => {
        if (ref.current) ref.current.returnValue = '';
        onClose();
      }}
      onPointerDown={(e) => {
        if (!closeOnBackdrop || !ref.current) return;
        pressedOutsideRef.current = isOutside(e, ref.current);
      }}
      onPointerUp={(e) => {
        if (!closeOnBackdrop || !ref.current) return;
        if (pressedOutsideRef.current && isOutside(e, ref.current)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
    >
      {open && (
        <div className="flex flex-col max-h-[84vh] bg-[var(--panel)] text-[var(--text)]">
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] shrink-0">
            <div className="min-w-0">
              <h1 id={titleId} className="text-base font-semibold leading-snug">
                {title}
              </h1>
              {description && <p className="text-[13px] text-[var(--text-sec)] mt-1">{description}</p>}
            </div>
            <IconButton aria-label="关闭弹窗" size="xs" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
          {footer && (
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--panel-sec)] flex items-center justify-end gap-2 shrink-0">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="420px"
      footer={
        <>
          <Button variant="outline" onClick={onClose} autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={loading}
            onClick={onConfirm}
            autoFocus={!destructive}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--text-sec)]">{message}</p>
    </Dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 340,
  minWidth = 280,
  maxWidth = 560,
  resizable = false,
  onWidthChange,
  side = 'right',
  headerExtra,
  className = '',
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  onWidthChange?: (nextWidth: number) => void;
  side?: 'right' | 'left';
  headerExtra?: ReactNode;
  className?: string;
}) {
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragStateRef.current || !onWidthChange) return;
      const delta = side === 'right' ? dragStateRef.current.startX - e.clientX : e.clientX - dragStateRef.current.startX;
      const next = Math.min(maxWidth, Math.max(minWidth, Math.round(dragStateRef.current.startWidth + delta)));
      onWidthChange(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, maxWidth, minWidth, onWidthChange, side]);

  if (!open) return null;

  return (
    <aside
      aria-label={title}
      style={{ width: `${width}px` }}
      className={`relative shrink-0 h-full max-w-[92vw] bg-[var(--panel)] flex flex-col overflow-hidden ${
        side === 'right' ? 'border-l border-[var(--border)]' : 'border-r border-[var(--border)]'
      } ${className}`}
    >
      {resizable && onWidthChange && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整面板宽度"
          onPointerDown={(e) => {
            e.preventDefault();
            dragStateRef.current = { startX: e.clientX, startWidth: width };
            setDragging(true);
          }}
          className={`hidden md:block absolute top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-[var(--primary)]/30 transition-colors ${
            side === 'right' ? 'left-0' : 'right-0'
          } ${dragging ? 'bg-[var(--primary)]/40' : ''}`}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
          {subtitle && <div className="text-xs text-[var(--text-sec)] truncate mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          {onClose && (
            <IconButton aria-label={`关闭${title}`} size="xs" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 transition-opacity duration-[var(--duration-instant)] absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] text-[11px] text-[var(--text)] whitespace-nowrap shadow-[var(--shadow-sm)] z-[var(--z-popover)]"
      >
        {content}
      </span>
    </span>
  );
}

export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = 'right',
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger}
      {open && (
        <div
          className={`absolute top-full mt-1.5 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-md)] z-[var(--z-popover)] p-2 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Dropdown({
  open,
  onClose,
  trigger,
  items,
  align = 'right',
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  items: Array<{ id: string; label: string; onSelect: () => void; destructive?: boolean; active?: boolean }>;
  align?: 'left' | 'right';
}) {
  return (
    <Popover open={open} onClose={onClose} trigger={trigger} align={align}>
      <div role="menu" className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`w-full text-left px-2.5 py-1.5 rounded-[var(--radius-xs)] text-[13px] cursor-pointer hover:bg-[var(--panel-sec)] ${
              item.destructive
                ? 'text-[var(--error)]'
                : item.active
                  ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                  : 'text-[var(--text)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}
