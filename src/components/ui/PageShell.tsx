/**
 * 全站页面外壳 —— 统一移动/桌面布局节奏。
 *
 * 设计取舍：这是「移动优先」的单列阅读应用，桌面端不强行铺满（多列会破坏专注捕获/复习的体验），
 * 而是给一个舒适的阅读宽度并在大屏拉开上下留白、增大水平内边距，使其看起来是「为大屏排过版」
 * 而非「手机布局拉伸居中」。底部留白为全局底栏（h≈4rem + 安全区）让位。
 *
 * - max-w-content（640px）：比原来的 max-w-lg（512px）更宽松，桌面更挺括。
 * - sm: 起更大的水平/顶部内边距；底部固定为底栏让位。
 */
import { cn } from './cn';

export default function PageShell({
  children,
  className,
  width = 'content',
}: {
  children: React.ReactNode;
  className?: string;
  /** content：常规单列；wide：库/列表类可略宽。 */
  width?: 'content' | 'wide';
}) {
  return (
    <main
      className={cn(
        'mx-auto flex min-h-dvh w-full flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10',
        width === 'wide' ? 'max-w-2xl' : 'max-w-content',
        className
      )}
    >
      {children}
    </main>
  );
}
