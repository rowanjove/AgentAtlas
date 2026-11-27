import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { Button } from './Button';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

const BADGE_STYLE: Record<BadgeTone, { color: string; bg: string }> = {
  neutral: { color: 'var(--text-sec)', bg: 'var(--panel-sec)' },
  primary: { color: 'var(--primary)', bg: 'var(--selected-bg)' },
  success: { color: 'var(--success)', bg: 'var(--success-bg)' },
  warning: { color: 'var(--warning)', bg: 'var(--warning-bg)' },
  error: { color: 'var(--error)', bg: 'var(--error-bg)' },
  info: { color: 'var(--info)', bg: 'var(--info-bg)' },
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const s = BADGE_STYLE[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-xs)] text-xs font-medium leading-tight border border-transparent ${className}`}
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {children}
    </span>
  );
}

export function Progress({
  value,
  max = 100,
  label,
  showPercent = false,
  size = 'sm',
}: {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  size?: 'xs' | 'sm';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="space-y-1">
      {(label || showPercent) && (
        <div className="flex items-center justify-between gap-2 text-[13px] text-[var(--text-sec)]">
          {label && <span className="truncate">{label}</span>}
          {showPercent && <span className="font-mono tabular-nums shrink-0">{pct}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`w-full rounded-full bg-[var(--panel-sec)] overflow-hidden ${size === 'xs' ? 'h-1.5' : 'h-2'}`}
      >
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-out)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-[13px] text-[var(--text-sec)] min-w-0 overflow-hidden">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5 min-w-0">
              {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
              {item.to && !isLast ? (
                <Link to={item.to} className="hover:text-[var(--text)] truncate transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className={`truncate ${isLast ? 'text-[var(--text)] font-medium' : ''}`}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Table({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (nextPage: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-xs text-[var(--text-sec)]">
      <span>
        第 <span className="font-mono text-[var(--text)]">{page}</span> / {totalPages} 页
        {totalItems !== undefined ? `（共 ${totalItems} 项）` : ''}
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </Button>
        <Button size="xs" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}

export interface TreeGroupItem {
  id: string;
  label: string;
  meta?: string;
  defaultOpen?: boolean;
  children: Array<{
    id: string;
    label: string;
    to: string;
    active?: boolean;
    leading?: ReactNode;
    trailing?: ReactNode;
  }>;
}

export function Tree({ groups }: { groups: TreeGroupItem[] }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const isOpen = collapsed[group.id] !== undefined ? !collapsed[group.id] : group.defaultOpen ?? true;
        return (
          <div key={group.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: isOpen }))}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[var(--radius-xs)] text-[13px] font-medium text-[var(--text-sec)] hover:text-[var(--text)] hover:bg-[var(--panel-sec)] cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                )}
                <span className="truncate">{group.label}</span>
              </span>
              {group.meta && <span className="font-mono text-xs text-[var(--text-muted)] shrink-0">{group.meta}</span>}
            </button>
            {isOpen && (
              <div className="mt-0.5 ml-3 pl-2.5 border-l border-[var(--border)] space-y-0.5">
                {group.children.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-[var(--radius-xs)] text-sm transition-colors ${
                      item.active
                        ? 'bg-[var(--selected-bg)] text-[var(--primary)] font-medium'
                        : 'text-[var(--text-sec)] hover:text-[var(--text)] hover:bg-[var(--panel-sec)]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      {item.leading}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.trailing}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-xs)] bg-[var(--panel-sec)] ${className}`} aria-hidden="true" />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--panel)]">
      <div className="text-[var(--text-muted)] mb-2">{icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}</div>
      <div className="text-sm font-medium text-[var(--text)]">{title}</div>
      {description && <p className="text-[13px] text-[var(--text-sec)] mt-1 max-w-md">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = '加载失败',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p-5 max-w-xl mx-auto my-6 rounded-[var(--radius-md)] border border-[var(--error)]/35 bg-[var(--panel)] space-y-3">
      <div className="flex items-center gap-2 text-[var(--error)]">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <p className="text-[13px] font-mono text-[var(--text-sec)] break-words">{message}</p>
      {onRetry && (
        <Button variant="primary" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}
