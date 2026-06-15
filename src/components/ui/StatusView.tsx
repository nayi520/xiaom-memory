/**
 * 统一异步状态展示（加载 / 空 / 错误）——把各页就地重复的「裸 spinner / 一行字 / 各写一遍的错误块」
 * 收敛为一致的三态组件，复用既有 Skeleton / EmptyState / Button 设计语言。
 *
 * 用法一（声明式 <StatusView>）：包住列表区，按 phase 渲染对应态，data 态把 children 透出。
 *   <StatusView
 *     phase={phase}                       // 'loading' | 'error' | 'empty' | 'ready'
 *     skeleton={<SkeletonList count={6}/>}// 加载骨架（不传则用默认列表骨架）
 *     error={errMsg} onRetry={reload}     // 错误文案 + 重试
 *     empty={{ icon, title, description }}// 空态（透传给 EmptyState）
 *   >
 *     {children}
 *   </StatusView>
 *
 * 用法二（<ErrorState> 独立块）：在自管状态的组件里就地复用统一错误展示。
 *
 * a11y：加载区 role=status + aria-busy；错误区 role=alert。深浅色随设计系统。
 */
import Button from './Button';
import EmptyState from './EmptyState';
import { SkeletonList } from './Skeleton';
import { WarningIcon } from './icons';
import { cn } from './cn';

export type StatusPhase = 'loading' | 'error' | 'empty' | 'ready';

/** 统一错误块：图标 + 文案 + 可选「重试」。供 StatusView 与自管状态组件复用。 */
export function ErrorState({
  title = '加载失败',
  description,
  onRetry,
  retryLabel = '重新加载',
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={<WarningIcon aria-hidden className="h-7 w-7 text-amber-400" />}
        title={title}
        description={description ?? '请稍后重试。'}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

interface EmptyConfig {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export default function StatusView({
  phase,
  skeleton,
  error,
  onRetry,
  retryLabel,
  empty,
  className,
  children,
}: {
  phase: StatusPhase;
  /** 加载骨架；不传用默认列表骨架（6 条）。 */
  skeleton?: React.ReactNode;
  /** 错误文案（phase==='error' 时展示）。 */
  error?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** 空态配置（phase==='empty' 时透传 EmptyState）。 */
  empty?: EmptyConfig;
  className?: string;
  children?: React.ReactNode;
}) {
  if (phase === 'loading') {
    return (
      <div role="status" aria-busy className={cn('animate-fade-in', className)}>
        {skeleton ?? <SkeletonList count={6} />}
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <ErrorState
        description={error}
        onRetry={onRetry}
        retryLabel={retryLabel}
        className={className}
      />
    );
  }
  if (phase === 'empty' && empty) {
    return (
      <div className={className}>
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      </div>
    );
  }
  return <>{children}</>;
}
