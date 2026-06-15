/**
 * 中间件 —— 去 Supabase 改造（Auth.js 会话）
 *
 * 用 Auth.js v5 的 `auth` 包裹中间件：req.auth 即当前 session（JWT 模式下读 cookie + 验签）。
 * 取代原 Supabase 的会话刷新（createServerClient + getUser）。
 *
 * 放行逻辑沿用 PUBLIC_PATHS；额外放行 /api/auth（Auth.js 自身的 signin/callback/session 等端点，
 * 否则未登录态下登录流程会被重定向到 /login 形成死循环）。
 */

import { NextResponse } from 'next/server';
// Edge 安全实例（不含 adapter/providers，避免 postgres.js / node:crypto 进 Edge 包）。
import { auth } from '@/lib/auth/edge';

/** 无需登录即可访问的路径前缀：
 *  - /login：登录页
 *  - /terms、/privacy：法务页（用户协议 / 隐私政策，注册前可读）
 *  - /auth：历史路径占位（旧 Supabase 回调已删，保留前缀避免误拦截）
 *  - /api/auth：Auth.js 端点（magic link 回调 / session / csrf / signout 等）
 *  - /api/register：邮箱+密码注册（未登录态调用，自行做输入校验 + 限频 + 门禁）
 *  - /api/verify-email：邮箱验证落地（点邮件链接，未登录访问）
 *  - /api/resend-verification：重发验证邮件（未登录访问，自行限频）
 *  - /api/captcha：下发签名算术挑战（注册验证码，未登录访问）
 *  - /api/admin：管理端点（用 Bearer ADMIN_SECRET 自行鉴权，如发邀请码）
 *  - /api/cron：用 Bearer CRON_SECRET 自行鉴权
 */
const PUBLIC_PATHS = [
  '/login',
  '/terms',
  '/privacy',
  '/auth',
  '/api/auth',
  '/api/register',
  '/api/verify-email',
  '/api/resend-verification',
  '/api/captcha',
  '/api/admin',
  '/api/cron',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isLoggedIn = Boolean(req.auth?.user?.id);

  // 未登录访问受保护页 → 跳登录
  if (!isLoggedIn && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 已登录还停在登录页 → 跳首页
  if (isLoggedIn && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * 排除静态资源与 PWA 文件：
     * _next/static, _next/image, favicon, manifest, sw, icons, 常见图片
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
