import type { Metadata, Viewport } from 'next';
import './globals.css';
import SwRegister from './sw-register';
import BottomNav from '@/components/BottomNav';
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
  themeColor: '#4F46E5',
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
            {children}
            <BottomNav />
            <SwRegister />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
