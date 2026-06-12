/**
 * 小徽标/标签（语义色一套，替代各处手写的 rounded-full px-2 py-0.5 text-[10px] …）。
 * tone：neutral / brand / amber / sky / emerald / red。
 */
import { cn } from './cn';

type Tone = 'neutral' | 'brand' | 'amber' | 'sky' | 'emerald' | 'red';

const TONES: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  brand: 'bg-brand-light text-brand dark:bg-brand/15 dark:text-brand-100',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
};

export default function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium leading-tight',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
