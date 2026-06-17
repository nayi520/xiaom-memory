'use client';

/**
 * 全局错误边界（V18）——兜住「根 layout 自身」崩溃的极端情况。
 *
 * 与 app/error.tsx 的区别：global-error 会**替换整个根 layout**（含 <html>/<body>），
 * 因此它必须自带文档骨架，且不能依赖 ThemeProvider/ToastProvider 等（那些可能正是出错源）。
 * 仅在最外层渲染失败时触发；正常路由错误由 app/error.tsx 接管。
 *
 * 故意写成零依赖、内联样式的极简页：无论设计系统是否可用都能显示，给用户「刷新」出路。
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
          background: '#fafafa',
          color: '#3f3f46',
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}>😵‍💫</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>页面出错了</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#71717a', margin: '0 0 20px' }}>
            遇到了一个意外问题。刷新一下试试，或稍后再来。
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                appearance: 'none',
                border: 'none',
                borderRadius: 10,
                padding: '9px 18px',
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                background: '#4F46E5',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <a
              href="/"
              style={{
                display: 'inline-block',
                borderRadius: 10,
                padding: '9px 18px',
                fontSize: 14,
                fontWeight: 600,
                color: '#3f3f46',
                background: '#fff',
                border: '1px solid #e4e4e7',
                textDecoration: 'none',
              }}
            >
              返回首页
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
