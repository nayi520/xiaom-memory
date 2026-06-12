/**
 * 统一按钮（替代散落各处的 rounded-xl bg-brand py-3 … 重复样式）。
 * 变体：primary / secondary / ghost / danger / dangerSolid。
 * 尺寸：sm / md / lg。支持 loading（自带 spinner，禁用并保留宽度）、fullWidth。
 * hover（桌面）+ active（触摸）+ focus-visible（键盘）三态齐全，过渡统一。
 */
import { forwardRef } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-field font-semibold transition duration-150 ease-smooth focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white shadow-card hover:bg-brand-dark hover:shadow-card-hover active:scale-[0.98]',
  secondary:
    'border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800',
  ghost:
    'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.97] dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
  danger:
    'border border-red-200 bg-white text-red-600 hover:bg-red-50 active:scale-[0.98] dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950',
  dangerSolid:
    'bg-red-500 text-white shadow-card hover:bg-red-600 active:scale-[0.98]',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-4 py-3.5 text-base',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth,
    loading,
    disabled,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
      />
    </svg>
  );
}

export default Button;
