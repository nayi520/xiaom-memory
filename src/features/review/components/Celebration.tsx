'use client';

/**
 * 复习达成庆祝（V20）——达成每日目标 / 连续打卡里程碑时的一次性轻量庆祝。
 *
 * 触发方在外层判定「该不该庆祝」（首次达标、里程碑），本组件只负责「怎么庆祝」：
 *  - 顶部飘一条祝贺横幅（对勾脉冲 + 文案），数秒后自动淡出，**不打断继续复习**
 *    （整层 pointer-events-none，点击穿透到下面的卡片/按钮）。
 *  - 动效充裕时撒一阵纸屑（纯 CSS，无依赖）；
 *  - **尊重 prefers-reduced-motion**：开启「减少动态效果」时完全不渲染纸屑、不做位移动画，
 *    仅保留静态祝贺横幅（仍可被读屏播报），动效降级但信息不丢。
 *  - 横幅文案放在 role=status / aria-live=polite 容器里，无障碍可感知。
 *
 * 生命周期：受控显示（show=true 时挂载并起一个自动关闭计时器，到点回调 onDone）。
 */

import { useEffect, useMemo } from 'react';
import { cn } from '@/components/ui';
import { usePrefersReducedMotion } from '@/components/usePrefersReducedMotion';

/** 纸屑片数（动效模式下）。控制在小范围，轻量不喧宾夺主。 */
const CONFETTI_COUNT = 28;
/** 庆祝横幅自动消失时长（ms）。 */
const AUTO_DISMISS_MS = 4200;
/** 纸屑配色（品牌色系 + 暖色点缀，深浅色都清晰）。 */
const CONFETTI_COLORS = [
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
  '#a78bfa', // violet-400
  '#facc15', // yellow-400
];

export interface CelebrationProps {
  /** 是否展示（true 时挂载并开始自动关闭计时）。 */
  show: boolean;
  /** 标题（如「今日目标达成！」）。 */
  title: string;
  /** 副文案（如「已完成 10 张 · 连续 7 天」）。 */
  message?: string;
  /** 自动消失或被关闭后的回调（外层据此复位「已庆祝」标记 / 卸载）。 */
  onDone: () => void;
}

/** 一片纸屑的随机参数（位置 / 漂移 / 旋转 / 时长 / 配色），由 CSS 变量驱动 keyframes。 */
interface Piece {
  left: number; // 起始横向位置（vw 百分比）
  dx: string; // 横向漂移
  dy: string; // 下落距离
  rot: string; // 旋转角
  dur: string; // 时长
  delay: string; // 起始延迟
  color: string;
  size: number; // 边长 px
  round: boolean; // 圆形 or 方形
}

/** 生成 n 片纸屑的随机参数（挂载时一次性，避免每帧抖动）。 */
function makePieces(n: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const left = Math.round(Math.random() * 100);
    const drift = Math.round((Math.random() * 2 - 1) * 24); // ±24vw
    pieces.push({
      left,
      dx: `${drift}vw`,
      dy: `${70 + Math.round(Math.random() * 20)}vh`,
      rot: `${Math.round(360 + Math.random() * 540)}deg`,
      dur: `${(1.3 + Math.random() * 1.1).toFixed(2)}s`,
      delay: `${(Math.random() * 0.35).toFixed(2)}s`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.round(Math.random() * 6),
      round: Math.random() > 0.5,
    });
  }
  return pieces;
}

export default function Celebration({
  show,
  title,
  message,
  onDone,
}: CelebrationProps) {
  const reducedMotion = usePrefersReducedMotion();

  // 纸屑参数仅在「需要展示且允许动效」时生成一次。
  const pieces = useMemo(
    () => (show && !reducedMotion ? makePieces(CONFETTI_COUNT) : []),
    [show, reducedMotion]
  );

  // 自动关闭计时（show 为真时启动；离场或 show 变化时清理）。
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [show, onDone]);

  if (!show) return null;

  return (
    // 整层不拦截指针：庆祝期间仍可继续翻面 / 评分。
    <div
      aria-hidden={false}
      className="pointer-events-none fixed inset-0 z-[55] overflow-hidden"
    >
      {/* 纸屑层（仅动效模式）。reduced-motion 下整段不渲染。 */}
      {!reducedMotion &&
        pieces.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-[-5vh] block animate-confetti-fall"
            style={
              {
                left: `${p.left}vw`,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                borderRadius: p.round ? '9999px' : '2px',
                ['--confetti-dx' as string]: p.dx,
                ['--confetti-dy' as string]: p.dy,
                ['--confetti-rot' as string]: p.rot,
                ['--confetti-dur' as string]: p.dur,
                ['--confetti-delay' as string]: p.delay,
              } as React.CSSProperties
            }
          />
        ))}

      {/* 祝贺横幅（动效/静态都展示）：顶部居中，读屏可播报。 */}
      <div className="pointer-events-none absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3rem))] flex justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'glass flex items-center gap-3 rounded-pill border border-emerald-200/80 px-4 py-2.5 shadow-pop ring-1 ring-emerald-500/10 dark:border-emerald-800/80',
            // 动效模式下横幅做一次脉冲入场；reduced-motion 下静态出现。
            reducedMotion ? '' : 'motion-safe:animate-celebrate-pop'
          )}
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 text-base shadow-sm"
          >
            🎉
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-emerald-700 dark:text-emerald-300">
              {title}
            </p>
            {message && (
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
