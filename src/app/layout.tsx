import type { Metadata, Viewport } from 'next';
import './globals.css';
import SwRegister from './sw-register';
import BottomNav from '@/components/BottomNav';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://memory.okr.nayitools.cn'),
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
    <html lang="zh-CN">
      <body>
        {children}
        <BottomNav />
        <SwRegister />
      </body>
    </html>
  );
}
