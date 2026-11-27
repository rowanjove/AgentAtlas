import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';

export type ControlSize = 'xs' | 'sm' | 'md';

const CONTROL_HEIGHTS: Record<ControlSize, string> = {
  xs: 'h-7 text-[13px] px-2.5 rounded-[var(--radius-xs)]',
  sm: 'h-8 text-sm px-3 rounded-[var(--radius-sm)]',
  md: 'h-9 text-sm px-3 rounded-[var(--radius-sm)]',
};

const CONTROL_BASE =
  'w-full border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] placeholder:text-[var(--text-muted)] ' +
  'transition-colors duration-[var(--duration-fast)] ' +
  'hover:border-[var(--border-strong)] focus:outline-none focus:border-[var(--primary)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  controlSize?: ControlSize;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { controlSize = 'sm', leftIcon, rightSlot, invalid = false, className = '', ...rest },
  ref,
) {
  const borderClass = invalid ? 'border-[var(--error)] focus:border-[var(--error)]' : '';
  if (!leftIcon && !rightSlot) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${CONTROL_BASE} ${CONTROL_HEIGHTS[controlSize]} ${borderClass} ${className}`}
        {...rest}
      />
    );
  }
  return (
    <div className="relative flex items-center w-full">
      {leftIcon && (
        <span className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none inline-flex">
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${CONTROL_BASE} ${CONTROL_HEIGHTS[controlSize]} ${leftIcon ? 'pl-8' : ''} ${
          rightSlot ? 'pr-8' : ''
        } ${borderClass} ${className}`}
        {...rest}
      />
      {rightSlot && <span className="absolute right-2 inline-flex">{rightSlot}</span>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${CONTROL_BASE} p-3 text-sm leading-relaxed rounded-[var(--radius-sm)] ${
        invalid ? 'border-[var(--error)] focus:border-[var(--error)]' : ''
      } ${className}`}
      {...rest}
    />
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  controlSize?: ControlSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { controlSize = 'sm', className = '', children, ...rest },
  ref,
) {
  return (
    <div className="relative inline-flex items-center">
      <select
        ref={ref}
        className={`${CONTROL_BASE} ${CONTROL_HEIGHTS[controlSize]} pr-8 appearance-none cursor-pointer ${className}`}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none absolute right-2.5"
        aria-hidden="true"
      />
    </div>
  );
});

export function Checkbox({
  label,
  description,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: string }) {
  return (
    <label className={`inline-flex items-start gap-2 cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded-[var(--radius-xs)] border-[var(--border-strong)] accent-[var(--primary)] cursor-pointer"
        {...rest}
      />
      {(label || description) && (
        <span className="text-sm leading-snug">
          {label && <span className="text-[var(--text)]">{label}</span>}
          {description && <span className="block text-xs text-[var(--text-sec)] mt-0.5">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Radio({
  label,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer select-none ${className}`}>
      <input
        type="radio"
        className="h-4 w-4 accent-[var(--primary)] cursor-pointer"
        {...rest}
      />
      {label && <span className="text-sm text-[var(--text)]">{label}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none disabled:opacity-45 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-[var(--duration-fast)] ${
          checked
            ? 'bg-[var(--primary)] border-[var(--primary)]'
            : 'bg-[var(--panel-sec)] border-[var(--border-strong)]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-[var(--shadow-xs)] transition-transform duration-[var(--duration-fast)] ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
