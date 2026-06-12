/**
 * 统一空状态（替代各处「mt-10 text-center text-sm text-zinc-400 一行字」）。
 * 图标置于柔和圆形底座中，标题 + 说明 + 可选行动，居中且有呼吸感。
 */
import { cn } from './cn';

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'animate-fade-in flex flex-col items-center justify-center px-6 py-16 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-zinc-100 to-zinc-50 text-3xl shadow-card ring-1 ring-zinc-200/60 dark:from-zinc-800 dark:to-zinc-900 dark:ring-zinc-700/60">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-zinc-400 dark:text-zinc-500">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
