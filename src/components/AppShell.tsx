'use client';

/**
 * 响应式应用外壳 —— 一套代码、Tailwind 断点切换两种形态。
 *
 *   桌面（lg 及以上）：左侧常驻侧栏（SidebarNav）+ 右侧充分利用横向空间的内容区。
 *                      侧栏 sticky 贴顶占满视口高度，内容区随页面滚动。
 *   移动（< lg）     ：不渲染侧栏，仅输出页面内容；底部 Tab 栏（BottomNav，全局挂载）
 *                      负责导航，保持既有单列体验不退化。
 *
 * 登录 / 鉴权页不套壳：直接渲染 children（这些页面是独立的居中布局，不应出现侧栏/底栏）。
 *
 * 与 Next App Router 的关系：本组件在根 layout 里包住 {children}，对所有路由生效；
 * 是否套壳由 pathname 决定，无需为登录页单独建 route group。
 */

import { usePathname } from 'next/navigation';
import SidebarNav from './SidebarNav';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 登录 / 历史鉴权占位 / 法务页（注册前可读）：不套壳。
  const bare =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy');

  if (bare) return <>{children}</>;

  return (
    <div className="lg:flex">
      {/* 跳到主内容（a11y）：键盘 Tab 第一下聚焦显现，跳过侧栏直达正文。 */}
      <a href="#main-content" className="skip-link">
        跳到主内容
      </a>

      {/* 桌面侧栏：sticky 贴顶、占满视口高度；移动端隐藏 */}
      <aside className="sticky top-0 z-30 hidden h-dvh w-[260px] shrink-0 lg:block">
        <SidebarNav />
      </aside>

      {/* 内容区：占据剩余横向空间。min-w-0 避免长内容把弹性容器撑破。
          id + tabIndex=-1 作为「跳到主内容」锚点；内部页面的 <main>（PageShell）提供地标，
          故此处用 div 不再加 main，避免嵌套多个 main 地标。 */}
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {children}
      </div>
    </div>
  );
}
