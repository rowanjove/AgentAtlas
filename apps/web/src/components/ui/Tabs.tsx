import { useRef, type ReactNode } from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = 'underline',
  className = '',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  variant?: 'underline' | 'segmented';
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    const currentIdx = enabled.findIndex((item) => item.id === value);
    if (currentIdx === -1) return;

    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = enabled.length - 1;

    if (nextIdx !== -1) {
      e.preventDefault();
      const target = enabled[nextIdx];
      onChange(target.id);
      const btns = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)');
      const btn = btns?.[nextIdx];
      btn?.focus();
      btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  if (variant === 'segmented') {
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={`inline-flex items-center p-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-sec)] overflow-x-auto max-w-full ${className}`}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={`flex-none inline-flex items-center gap-1.5 h-7 px-2.5 text-[13px] font-medium rounded-[var(--radius-xs)] cursor-pointer transition-colors duration-[var(--duration-fast)] whitespace-nowrap disabled:opacity-45 ${
                selected
                  ? 'bg-[var(--panel)] text-[var(--text)] shadow-[var(--shadow-xs)] border-b-2 border-b-[var(--primary)]'
                  : 'text-[var(--text-sec)] hover:text-[var(--text)]'
              }`}
            >
              {item.icon && <span className="inline-flex shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="font-mono text-xs text-[var(--text-muted)]">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-5 border-b border-[var(--border)] overflow-x-auto ${className}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`relative flex-none inline-flex items-center gap-1.5 py-2.5 text-sm font-medium cursor-pointer transition-colors duration-[var(--duration-fast)] whitespace-nowrap disabled:opacity-45 ${
              selected ? 'text-[var(--primary)]' : 'text-[var(--text-sec)] hover:text-[var(--text)]'
            }`}
          >
            {item.icon && <span className="inline-flex shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="px-1.5 py-0.5 text-xs font-mono rounded-[var(--radius-xs)] bg-[var(--panel-sec)] text-[var(--text-sec)]">
                {item.count}
              </span>
            )}
            {selected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 border-b-2 border-[var(--primary)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
