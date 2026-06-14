/**
 * 全站页面外壳 —— 统一移动/桌面布局节奏，与响应式 AppShell（侧栏 + 内容区）配套。
 *
 * 移动（< lg）：单列、舒适阅读宽度居中，底部为全局底栏让位（pb-28）。与改版前一致。
 * 桌面（lg+） ：在侧栏右侧的内容区里铺开——更大的水平/顶部内边距、更挺括的最大宽度，
 *               不再是「手机窄列居中」。底栏在桌面隐藏，故桌面去掉底部多余留白。
 *
 * width 取值（仅影响桌面最大宽度，移动端始终单列）：
 *   - content：常规阅读页（捕获 / 问答 / 设置 / 详情）。桌面给舒适阅读宽度，不铺满。
 *   - wide   ：列表 / 多栏页（知识库 / 时间线）。桌面更宽，利用横向空间。
 *   - full   ：自管布局页（如知识库主从双栏）。不限宽，仅给内边距，由页面自行分栏。
 */
import { cn } from './cn';

const WIDTHS = {
  content: 'max-w-content lg:max-w-3xl',
  wide: 'max-w-2xl lg:max-w-5xl',
  full: 'max-w-none',
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
        // 移动：单列居中 + 底栏让位；桌面：更大内边距、顶部留白，去掉底栏让位空白。
        'mx-auto flex min-h-dvh w-full flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10 lg:px-10 lg:pb-12 lg:pt-12 xl:px-14',
        WIDTHS[width],
        className
      )}
    >
      {children}
    </main>
  );
}
