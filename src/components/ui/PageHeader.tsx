/**
 * 统一页眉。标题不再整体染品牌色（原来每页 H1 都是 text-brand，过于喧宾夺主、压平层级），
 * 改为高对比中性大标题 + 可选副标题，仅在需要时点缀品牌色。右侧可放操作区（actions）。
 */
import { cn } from './cn';

export default function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 区块小标题：统一全站的 “uppercase tracking-wide” 段标题。 */
export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500',
        className
      )}
    >
      {children}
    </h2>
  );
}
