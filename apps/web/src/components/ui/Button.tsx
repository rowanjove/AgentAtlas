import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--primary)] text-[var(--on-primary)] border border-transparent hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]',
  secondary:
    'bg-[var(--panel-sec)] text-[var(--text)] border border-transparent hover:bg-[var(--panel-hover)] active:border-[var(--border-strong)]',
  outline:
    'bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--panel-hover)] hover:border-[var(--border-strong)] active:bg-[var(--panel-sec)]',
  ghost:
    'bg-transparent text-[var(--text-sec)] border border-transparent hover:bg-[var(--panel-sec)] hover:text-[var(--text)] active:bg-[var(--panel-hover)]',
  destructive:
    'bg-[var(--error)] text-white border border-transparent hover:brightness-95 active:brightness-90',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-[var(--radius-xs)]',
  sm: 'h-8 px-3 text-[13.5px] gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[var(--radius-sm)]',
  lg: 'h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]',
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 w-7 rounded-[var(--radius-xs)]',
  sm: 'h-8 w-8 rounded-[var(--radius-sm)]',
  md: 'h-9 w-9 rounded-[var(--radius-sm)]',
  lg: 'h-10 w-10 rounded-[var(--radius-md)]',
};

const BASE_BUTTON =
  'inline-flex items-center justify-center font-medium whitespace-nowrap select-none cursor-pointer ' +
  'transition-[background-color,border-color,color,opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] ' +
  'active:scale-[0.99] disabled:opacity-45 disabled:pointer-events-none';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'outline',
    size = 'sm',
    loading = false,
    leftIcon,
    rightIcon,
    active = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const activeStyle = active
    ? 'border-[var(--primary)] bg-[var(--selected-bg)] text-[var(--primary)]'
    : VARIANT_CLASSES[variant];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE_BUTTON} ${SIZE_CLASSES[size]} ${activeStyle} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  active?: boolean;
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'sm', loading = false, active = false, disabled, className = '', children, type = 'button', ...rest },
  ref,
) {
  const activeStyle = active
    ? 'border border-[var(--primary)] bg-[var(--selected-bg)] text-[var(--primary)]'
    : VARIANT_CLASSES[variant];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE_BUTTON} ${ICON_SIZE_CLASSES[size]} ${activeStyle} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
});

export interface SplitButtonOption {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function SplitButton({
  label,
  onClick,
  options,
  variant = 'outline',
  size = 'sm',
  disabled = false,
  loading = false,
  leftIcon,
}: {
  label: string;
  onClick: () => void;
  options: SplitButtonOption[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex items-stretch">
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        leftIcon={leftIcon}
        onClick={onClick}
        className="rounded-r-none border-r-0"
      >
        {label}
      </Button>
      <button
        type="button"
        disabled={disabled || loading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${label} 更多选项`}
        onClick={() => setOpen((v) => !v)}
        className={`${BASE_BUTTON} ${SIZE_CLASSES[size]} px-1.5 rounded-l-none ${VARIANT_CLASSES[variant]} border-l border-l-[var(--border)]`}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[168px] py-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-md)] z-[var(--z-popover)]"
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              disabled={opt.disabled}
              onClick={() => {
                setOpen(false);
                opt.onSelect();
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--panel-sec)] disabled:opacity-45 ${
                opt.destructive ? 'text-[var(--error)]' : 'text-[var(--text)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
