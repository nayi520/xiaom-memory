'use client';

/**
 * 产品导览（V12 新手引导第二步）——轻量分步高亮，介绍 捕获 / 复习 / 知识库 / 问小M 四大入口。
 *
 * 形态：coachmarks——遮罩挖空高亮当前入口（data-tour 锚点），旁边浮一张提示卡（上一步/下一步/跳过）。
 *  - 入口锚点桌面在侧栏、移动在底栏；按 data-tour 选择器实时定位，找不到（如移动端无「问小M」入口）
 *    的步骤自动跳过，不卡流程。
 *  - 「跳过」或走完最后一步即结束（onDone）；不再单独存「不再提示」——整段引导只首展一次，
 *    完成态由 onboarded 记录（与欢迎流共用），语义即「不再提示」。
 *
 * a11y / 体验：role=dialog；Esc / 「跳过」结束；位置随窗口 resize / 滚动重算。
 *   reduced-motion 下不做位移动画（motion-safe:* + globals 兜底）。复用 ui token，深浅色自适应。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  TextIcon,
  ReviewIcon,
  LibraryIcon,
  ListTodoIcon,
  AskIcon,
  CloseIcon,
  cn,
  type LucideIcon,
} from '@/components/ui';

interface TourStep {
  /** 对应 data-tour 值（nav-home / nav-review / nav-library / nav-ask）。 */
  target: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
}

const STEPS: TourStep[] = [
  {
    target: 'nav-home',
    Icon: TextIcon,
    title: '在这里捕获',
    desc: '随手记下想法、语音或链接。这是你和小M打交道的起点。',
  },
  {
    target: 'nav-review',
    Icon: ReviewIcon,
    title: '按时复习',
    desc: '到期的复习卡片会在这里，红点提示今天要复习的数量。',
  },
  {
    target: 'nav-library',
    Icon: LibraryIcon,
    title: '你的知识库',
    desc: 'AI 整理后的概念都归类在此，可下钻浏览、看关系图谱。',
  },
  {
    target: 'nav-todos',
    Icon: ListTodoIcon,
    title: '行动项',
    desc: '语音 / 会议里提到的待办，自动汇总到这里，勾掉即完成。',
  },
  {
    target: 'nav-ask',
    Icon: AskIcon,
    title: '问小M',
    desc: '基于你记录过的内容提问，它会作答并注明来源。',
  },
];

/** 提示卡相对锚点的间距与尺寸（px）。 */
const GAP = 12;
const CARD_W = 280;
const PAD = 12; // 视口边距

interface Placement {
  /** 高亮框（锚点 rect 外扩一点）。 */
  spot: { top: number; left: number; width: number; height: number };
  /** 提示卡定位。 */
  card: { top: number; left: number };
  /** 卡片在锚点的上 / 下 / 左 / 右（决定小箭头方向，纯装饰）。 */
  side: 'top' | 'bottom' | 'left' | 'right';
}

/** 计算某锚点元素的高亮框与提示卡位置（视口坐标，fixed 定位）。 */
function computePlacement(el: Element): Placement {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spotPad = 6;
  const spot = {
    top: r.top - spotPad,
    left: r.left - spotPad,
    width: r.width + spotPad * 2,
    height: r.height + spotPad * 2,
  };

  // 估一个卡片高度（内容固定，约 140–170）；用于判断上/下空间。
  const cardH = 168;
  const spaceBelow = vh - r.bottom;
  const spaceAbove = r.top;
  const spaceRight = vw - r.right;

  let side: Placement['side'];
  let top: number;
  let left: number;

  if (spaceRight >= CARD_W + GAP + PAD) {
    // 桌面侧栏场景：锚点在左，卡片放右侧、垂直居中对齐。
    side = 'right';
    left = r.right + GAP;
    top = Math.min(
      Math.max(PAD, r.top + r.height / 2 - cardH / 2),
      vh - cardH - PAD
    );
  } else if (spaceAbove >= cardH + GAP + PAD && spaceAbove >= spaceBelow) {
    // 移动底栏场景：锚点在下，卡片放其上方。
    side = 'top';
    top = r.top - GAP - cardH;
    left = clamp(r.left + r.width / 2 - CARD_W / 2, PAD, vw - CARD_W - PAD);
  } else if (spaceBelow >= cardH + GAP + PAD) {
    side = 'bottom';
    top = r.bottom + GAP;
    left = clamp(r.left + r.width / 2 - CARD_W / 2, PAD, vw - CARD_W - PAD);
  } else {
    // 兜底：居中偏上，保证可见。
    side = 'top';
    top = clamp(r.top - GAP - cardH, PAD, vh - cardH - PAD);
    left = clamp(r.left + r.width / 2 - CARD_W / 2, PAD, vw - CARD_W - PAD);
  }

  return { spot, card: { top, left }, side };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export default function ProductTour({ onDone }: { onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // 当前步骤的锚点元素（找不到则该步无效）。
  const targetRef = useRef<Element | null>(null);

  const step = STEPS[idx];

  /** 找当前步骤锚点；若不存在，自动前进（向 dir 方向）跳过它。 */
  const locate = useCallback(
    (i: number, dir: 1 | -1): number => {
      let cur = i;
      for (let guard = 0; guard < STEPS.length; guard++) {
        const s = STEPS[cur];
        const el = document.querySelector(`[data-tour="${s.target}"]`);
        if (el && (el as HTMLElement).offsetParent !== null) {
          targetRef.current = el;
          return cur;
        }
        cur += dir;
        if (cur < 0 || cur >= STEPS.length) return -1; // 越界：无更多可用步骤
      }
      return -1;
    },
    []
  );

  // 进入 / idx 变化时定位锚点并算位置。
  useLayoutEffect(() => {
    const resolved = locate(idx, 1);
    if (resolved < 0) {
      onDone();
      return;
    }
    if (resolved !== idx) {
      setIdx(resolved);
      return;
    }
    const el = targetRef.current;
    if (el) setPlacement(computePlacement(el));
  }, [idx, locate, onDone]);

  // 窗口 resize / 滚动时重算高亮位置。
  useEffect(() => {
    function recompute() {
      const el = targetRef.current;
      if (el && (el as HTMLElement).offsetParent !== null) {
        setPlacement(computePlacement(el));
      }
    }
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, []);

  // Esc 结束。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const next = useCallback(() => {
    setIdx((i) => {
      const resolved = locate(i + 1, 1);
      if (resolved < 0) {
        onDone();
        return i;
      }
      return resolved;
    });
  }, [locate, onDone]);

  const prev = useCallback(() => {
    setIdx((i) => {
      const resolved = locate(i - 1, -1);
      // 没有更靠前的可用步骤就停在当前。
      return resolved < 0 ? i : resolved;
    });
  }, [locate]);

  if (!placement) return null;

  const isLast = idx === STEPS.length - 1;
  const isFirst = idx === 0;

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label={`产品导览：${step.title}`}
    >
      {/* 遮罩 + 高亮挖空：用一个带超大 box-shadow 的镂空框模拟「聚光灯」，遮罩点击=跳过。 */}
      <div className="absolute inset-0" onClick={onDone}>
        <div
          className="pointer-events-none absolute rounded-field ring-2 ring-brand transition-all duration-200 ease-smooth"
          style={{
            top: placement.spot.top,
            left: placement.spot.left,
            width: placement.spot.width,
            height: placement.spot.height,
            boxShadow: '0 0 0 9999px rgba(24,24,27,0.55)',
          }}
        />
      </div>

      {/* 提示卡 */}
      <div
        className="glass absolute w-[280px] overflow-hidden rounded-card border border-zinc-200/80 shadow-pop motion-safe:animate-fade-in-up dark:border-zinc-700/80"
        style={{ top: placement.card.top, left: placement.card.left }}
        // 阻止冒泡到遮罩（避免点卡片误关）。
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <step.Icon aria-hidden className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {step.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {step.desc}
              </p>
            </div>
            <button
              type="button"
              onClick={onDone}
              aria-label="跳过引导"
              className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100/70 hover:text-zinc-600 focus-visible:outline-none dark:hover:bg-zinc-800/60 dark:hover:text-zinc-300"
            >
              <CloseIcon aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 进度点 + 操作 */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200/70 px-4 py-2.5 dark:border-zinc-800/70">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.target}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === idx ? 'w-4 bg-brand' : 'w-1.5 bg-zinc-300 dark:bg-zinc-600'
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={prev}>
                上一步
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isLast ? '完成' : '下一步'}
            </Button>
          </div>
        </div>
      </div>

      {/* 左下角「跳过引导」常驻入口（卡片之外也能跳过） */}
      <button
        type="button"
        onClick={onDone}
        className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-pill bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-card ring-1 ring-zinc-200/70 backdrop-blur transition hover:text-zinc-700 focus-visible:outline-none lg:bottom-4 lg:left-4 lg:translate-x-0 dark:bg-zinc-900/90 dark:text-zinc-400 dark:ring-zinc-700/70 dark:hover:text-zinc-200"
      >
        跳过引导
      </button>
    </div>
  );
}
