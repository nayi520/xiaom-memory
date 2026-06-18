'use client';

/**
 * 轻量 Toast 反馈体系（Context + 组件 + useToast()）。
 *
 * 用途：把「保存成功 / 失败、已复制、操作结果」等转瞬即逝的反馈，从各处就地文字
 * 统一为右下角浮层提示（关键的行内表单校验仍保留在原位，见各编辑器）。
 *
 * 设计：
 *  - 无依赖，纯 React 状态机；最多同时展示若干条，超出自动挤掉最旧。
 *  - 默认 3s 自动消失（error 略长 5s），可手动关闭；hover/focus 暂停计时，避免来不及读。
 *  - a11y：容器 role=status + aria-live=polite（error 用 assertive），可被读屏播报；
 *    关闭按钮有 aria-label；reduced-motion 下不做位移动画。
 *  - 视觉：玻璃拟态卡片 + 语义色图标，深浅色一致；移动端贴底、桌面端右下。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from './cn';
import { SuccessIcon, FailIcon, AiIcon, CloseIcon } from './icons';
import type { LucideIcon } from './icons';

type ToastVariant = 'success' | 'error' | 'info';

/** Toast 行内动作（如「已删除 · 撤销」）：点击后执行回调并自动关闭该条。 */
export interface ToastAction {
  /** 按钮文案（如「撤销」）。 */
  label: string;
  /** 点击回调（执行后该 toast 自动关闭）。 */
  onClick: () => void;
}

export interface ToastOptions {
  /** 视觉/语义变体，决定图标与配色。默认 info。 */
  variant?: ToastVariant;
  /** 持续毫秒；不传按变体取默认（error 5s，其余 3s）。设 0 表示不自动消失。 */
  duration?: number;
  /** 可选行内动作按钮（撤销等）；含动作时默认延长展示时长，给用户反应时间。 */
  action?: ToastAction;
}

interface ToastItem extends Required<Pick<ToastOptions, 'variant'>> {
  id: number;
  message: string;
  duration: number;
  action?: ToastAction;
}

interface ToastApi {
  /** 通用：弹一条 toast，返回其 id（可用于手动 dismiss）。 */
  toast: (message: string, options?: ToastOptions) => number;
  success: (message: string, options?: ToastOptions) => number;
  error: (message: string, options?: ToastOptions) => number;
  info: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 同时最多展示条数（超出挤掉最旧，避免堆叠刷屏）。 */
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 3000;
const ERROR_DURATION = 5000;
/** 含撤销等行内动作时的默认展示时长（更长，给用户反应/点击的时间）。 */
const ACTION_DURATION = 6000;

const VARIANT_META: Record<
  ToastVariant,
  { Icon: LucideIcon; iconClass: string; live: 'polite' | 'assertive' }
> = {
  success: { Icon: SuccessIcon, iconClass: 'text-emerald-500', live: 'polite' },
  error: { Icon: FailIcon, iconClass: 'text-red-500', live: 'assertive' },
  info: { Icon: AiIcon, iconClass: 'text-brand', live: 'polite' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = ++idRef.current;
      const variant = options?.variant ?? 'info';
      const duration =
        options?.duration ??
        (options?.action
          ? ACTION_DURATION
          : variant === 'error'
            ? ERROR_DURATION
            : DEFAULT_DURATION);
      setItems((prev) =>
        [...prev, { id, message, variant, duration, action: options?.action }].slice(
          -MAX_TOASTS
        )
      );
      return id;
    },
    []
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m, o) => toast(m, { ...o, variant: 'success' }),
      error: (m, o) => toast(m, { ...o, variant: 'error' }),
      info: (m, o) => toast(m, { ...o, variant: 'info' }),
      dismiss,
    }),
    [toast, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** 访问 toast API。须在 <ToastProvider> 内使用。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用');
  }
  return ctx;
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    // 容器本身不做 live region：每条 ToastCard 自带 role=status + 按变体的 aria-live（polite/assertive），
    // 避免「容器 + 卡片」双重 live 造成读屏重复播报。
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+5rem))] sm:items-end sm:px-6">
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { Icon, iconClass, live } = VARIANT_META[item.variant];
  // hover/focus 暂停自动消失，移开后重新计时（用剩余时间近似为完整 duration，足够友好）。
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    const timer = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, paused, onDismiss]);

  return (
    <div
      role="status"
      aria-live={live}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        'glass pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card border border-zinc-200/80 px-4 py-3 shadow-pop ring-1 ring-black/[0.02] motion-safe:animate-fade-in-up dark:border-zinc-700/80'
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 h-5 w-5 shrink-0', iconClass)} />
      <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-100">
        {item.message}
      </p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss(item.id);
          }}
          className="-my-0.5 shrink-0 self-center rounded-md px-2 py-1 text-sm font-semibold text-brand transition hover:bg-brand/10 focus-visible:outline-none dark:hover:bg-brand/15"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="关闭提示"
        className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      >
        <CloseIcon aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
