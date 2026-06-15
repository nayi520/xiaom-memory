/**
 * 轻量内联 SVG 插画（用于空状态等场景的视觉升级）。
 *
 * 设计约定：
 *  - 纯内联 SVG，无外部资源 / 无额外依赖，随主题色与深浅色自适应；
 *  - 用 currentColor + 品牌色变量（text-brand / fill-current）着色，线性风格与 lucide 一致；
 *  - 统一 120×120 视图、stroke 圆头，装饰性，故 aria-hidden（语义由 EmptyState 标题承载）。
 *
 * 用法：作为 <EmptyState art={<EmptyBox/>} … /> 传入，替代小图标底座。
 */

type Props = { className?: string };

const WRAP =
  'h-28 w-28 text-brand [&_.bg]:fill-brand/10 [&_.line]:stroke-current [&_.dot]:fill-current';

/** 空盒子 / 空容器：通用「这里还什么都没有」。 */
export function EmptyBox({ className }: Props) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={`${WRAP} ${className ?? ''}`}>
      <ellipse className="bg" cx="60" cy="98" rx="40" ry="7" />
      <path
        className="line"
        d="M30 50 L60 38 L90 50 L60 62 Z"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        className="line"
        d="M30 50 V78 L60 90 V62"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        className="line"
        d="M90 50 V78 L60 90"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle className="dot" cx="60" cy="26" r="3" opacity="0.5" />
      <circle className="dot" cx="44" cy="32" r="2" opacity="0.35" />
      <circle className="dot" cx="78" cy="32" r="2" opacity="0.35" />
    </svg>
  );
}

/** 空知识库 / 概念：堆叠的卡片 + 连接点，呼应「整理成知识」。 */
export function EmptyLibrary({ className }: Props) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={`${WRAP} ${className ?? ''}`}>
      <ellipse className="bg" cx="60" cy="100" rx="38" ry="6" />
      <rect className="bg" x="30" y="34" width="60" height="50" rx="8" />
      <rect
        className="line"
        x="30"
        y="34"
        width="60"
        height="50"
        rx="8"
        strokeWidth="3"
      />
      <path className="line" d="M44 50 H76" strokeWidth="3" strokeLinecap="round" />
      <path className="line" d="M44 60 H68" strokeWidth="3" strokeLinecap="round" />
      <path className="line" d="M44 70 H72" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <circle className="dot" cx="92" cy="30" r="4" />
      <circle className="dot" cx="28" cy="30" r="3" opacity="0.5" />
    </svg>
  );
}

/** 空时间线：钟面 + 时间刻度，呼应「按时间记录」。 */
export function EmptyTimeline({ className }: Props) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={`${WRAP} ${className ?? ''}`}>
      <ellipse className="bg" cx="60" cy="100" rx="34" ry="6" />
      <circle className="bg" cx="60" cy="56" r="30" />
      <circle className="line" cx="60" cy="56" r="30" strokeWidth="3" />
      <path
        className="line"
        d="M60 56 V40 M60 56 L72 62"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path className="line" d="M60 30 V34 M86 56 H82 M60 82 V78 M34 56 H38" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** 空回收站：垃圾桶轮廓 + 漂浮虚线，呼应「这里是空的」。 */
export function EmptyTrash({ className }: Props) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={`${WRAP} ${className ?? ''}`}>
      <ellipse className="bg" cx="60" cy="100" rx="32" ry="6" />
      <path
        className="line"
        d="M40 44 H80 L76 88 A6 6 0 0 1 70 94 H50 A6 6 0 0 1 44 88 Z"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path className="line" d="M34 44 H86" strokeWidth="3" strokeLinecap="round" />
      <path className="line" d="M50 44 V38 A4 4 0 0 1 54 34 H66 A4 4 0 0 1 70 38 V44" strokeWidth="3" strokeLinejoin="round" />
      <path className="line" d="M54 56 V82 M60 56 V82 M66 56 V82" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/** 空搜索 / 无结果：放大镜 + 微光。 */
export function EmptySearch({ className }: Props) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden className={`${WRAP} ${className ?? ''}`}>
      <ellipse className="bg" cx="62" cy="100" rx="32" ry="6" />
      <circle className="bg" cx="54" cy="50" r="22" />
      <circle className="line" cx="54" cy="50" r="22" strokeWidth="3" />
      <path className="line" d="M70 66 L86 82" strokeWidth="4" strokeLinecap="round" />
      <path className="line" d="M46 44 A10 10 0 0 1 58 40" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
