import type { Metadata, Viewport } from 'next';
import './globals.css';
import SwRegister from './sw-register';
import BottomNav from '@/components/BottomNav';
import AppShell from '@/components/AppShell';
import CommandPalette from '@/components/CommandPalette';
import GlobalShortcuts from '@/components/shortcuts/GlobalShortcuts';
import ShortcutHelp from '@/components/shortcuts/ShortcutHelp';
import SessionExpiredGate from '@/components/SessionExpiredGate';
import { OfflineProvider } from '@/features/offline/OfflineProvider';
import OfflineIndicator from '@/features/offline/OfflineIndicator';
import InstallPrompt from '@/features/pwa/InstallPrompt';
import { OnboardingProvider } from '@/features/onboarding';
import { ThemeProvider, ToastProvider, themeInitScript } from '@/components/ui';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://memory.nayitools.cn'),
  title: '小M Memory',
  description: '你负责遇见，小M 替你记得。基于记忆曲线的个人知识记忆系统。',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '小M',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // viewport-fit=cover：让内容延伸到刘海/底部 home 条区域，配合 globals.css 的 env(safe-area-inset-*)
  // 适配——standalone PWA 沉浸感更强（顶/底栏自行用 safe-area 留白，正文不被遮挡）。
  viewportFit: 'cover',
  // 状态栏/地址栏主题色随深浅色切换：浅色用品牌靛蓝，深色用近黑（与 body dark 背景一致），
  // 避免深色模式下顶部仍是亮色块。两端浏览器（含 standalone）均按媒体查询选用对应色。
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4F46E5' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前按持久化偏好落 .dark/color-scheme，杜绝深色用户刷新闪白（须在 body 渲染前执行）。 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <OfflineProvider>
              <AppShell>{children}</AppShell>
              <BottomNav />
              <CommandPalette />
              {/* V20 全局快捷键监听 + V22 帮助浮层（? 唤起；设置页亦有入口）。 */}
              <GlobalShortcuts />
              <ShortcutHelp />
              <OfflineIndicator />
              <SessionExpiredGate />
              <InstallPrompt />
              <OnboardingProvider />
              <SwRegister />
            </OfflineProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
