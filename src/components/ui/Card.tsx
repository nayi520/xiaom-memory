/**
 * 统一卡片容器（替代 rounded-2xl border border-zinc-200 bg-white … 的重复）。
 * - `as` 可渲染为任意元素（li / section / div）。
 * - `interactive` 给可点击卡片加 hover 抬升 + active 反馈（桌面/触摸都顺滑）。
 * - `padded` 控制内边距（默认 true）。
 * 注意：Link 包裹的卡片请用普通 div + interactive，避免嵌套交互元素。
 */
import { cn } from './cn';

const SURFACE =
  'rounded-card border border-zinc-200/80 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900';

const INTERACTIVE =
  'transition duration-200 ease-smooth hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-card-hover active:translate-y-0 active:shadow-card dark:hover:border-zinc-700';

export function cardClass(opts?: { interactive?: boolean; padded?: boolean }) {
  return cn(
    SURFACE,
    opts?.padded !== false && 'p-5',
    opts?.interactive && INTERACTIVE
  );
}

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'li' | 'article';
  interactive?: boolean;
  padded?: boolean;
}

export default function Card({
  as: Tag = 'div',
  interactive,
  padded,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(cardClass({ interactive, padded }), className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
