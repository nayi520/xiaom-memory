/**
 * GET /api/verify-email?token=... —— 邮箱验证落地（注册门禁加固）
 *
 * 契约：
 *   - 有效 token  → 置 users.email_verified=true，删 token（一次性），302 跳 `/login?verified=1`
 *   - 缺/非法 token → 302 跳 `/login?verified=invalid`
 *   - 过期 token   → 302 跳 `/login?verified=expired`（用户可在登录页重发）
 *
 * 用浏览器直接打开（邮件链接），故用 302 重定向到登录页带提示，而非返回 JSON。
 * 公开端点（未登录可访问），已加入 middleware PUBLIC_PATHS。
 * 安全：**绝不打印 token**；token 一次性 + 过期（见 lib/auth/verification.ts）。
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { consumeVerification } from '@/lib/auth/verification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectToLogin(req: Request, status: 'ok' | 'invalid' | 'expired') {
  const url = new URL('/login', req.url);
  // verified=1 表示成功；其余传原因，登录页据此提示。
  url.searchParams.set('verified', status === 'ok' ? '1' : status);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  if (!isDatabaseConfigured()) {
    // 无库时无法校验，引导回登录页（按 invalid 提示）。
    return redirectToLogin(req, 'invalid');
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!token) return redirectToLogin(req, 'invalid');

  try {
    const result = await consumeVerification(token);
    return redirectToLogin(req, result);
  } catch {
    // 内部错误不泄露细节，也绝不打印 token。
    return redirectToLogin(req, 'invalid');
  }
}
