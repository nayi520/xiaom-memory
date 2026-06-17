/**
 * 全站页面外壳 —— 统一移动/桌面布局节奏，与响应式 AppShell（侧栏 + 内容区）配套。
 *
 * 移动（< lg）：单列、舒适阅读宽度居中，底部为全局底栏让位（pb-28）。与改版前一致。
 * 桌面（lg+） ：在侧栏右侧的内容区里铺开——更大的水平/顶部内边距、更挺括的最大宽度，
 *               不再是「手机窄列居中」。底栏在桌面隐藏，故桌面去掉底部多余留白。
 *
 * 「最大宽度」统一刻度（见 tailwind.config 的 maxWidth）：有意图、跨页一致，且在
 * 超宽屏（2xl ≥1536）逐级放大后封顶并 mx-auto 居中——两侧留白对称、不边到边拉伸，
 * 同时避免大屏下内容过窄空荡。各 width 档对应不同内容形态：
 *   - reading：单列长文 / 对话（问答 / 详情）。最舒适阅读行长，桌面也不铺满。
 *   - content：常规录入 / 表单页（捕获）。比 reading 略宽，承载双栏。
 *   - wide   ：列表 / 多栏概览页（设置 / 时间线）。利用横向空间，大屏更宽。
 *   - full   ：自管布局页（如知识库主从双栏 + 图谱）。不内限宽，由页面自行分栏；
 *              超宽屏由外层 app-2xl 封顶并居中，避免内容边到边发散。
 *
 * 水平内边距随视口放大（有上限）：lg 起更宽，2xl 再加一档呼吸感。
 */
import { cn } from './cn';

const WIDTHS = {
  reading: 'max-w-content lg:max-w-reading',
  content: 'max-w-content lg:max-w-content-lg 2xl:max-w-content-2xl',
  wide: 'max-w-2xl lg:max-w-wide-lg xl:max-w-wide-xl 2xl:max-w-wide-2xl',
  full: 'max-w-none 2xl:max-w-app-2xl',
} as const;

export default function PageShell({
  children,
  className,
  width = 'content',
}: {
  children: React.ReactNode;
  className?: string;
  width?: keyof typeof WIDTHS;
}) {
  return (
    <main
      className={cn(
        // 移动：单列居中 + 底栏让位；桌面：更大内边距、顶部留白，去掉底栏让位空白；2xl 再加呼吸感。
        // 顶部内边距在移动端叠加安全区（standalone PWA 刘海/状态栏让位）——
        // env(safe-area-inset-top) 在桌面/非刘海设备为 0，故退化为原 1.5rem，桌面渲染不变。
        'mx-auto flex min-h-dvh w-full flex-col px-4 pb-28 pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.5rem))] sm:px-6 sm:pt-10 lg:px-10 lg:pb-12 lg:pt-12 xl:px-14 2xl:px-16',
        WIDTHS[width],
        className
      )}
    >
      {children}
    </main>
  );
}
