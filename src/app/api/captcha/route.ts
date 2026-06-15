/**
 * GET /api/captcha —— 下发一道签名算术挑战（注册门禁加固 · 可选验证码）
 *
 * 契约：
 *   GET → 200 `{ question: "3 + 4 = ?", token: "<exp>.<sig>" }`
 *   - 验证码被禁用（CAPTCHA_DISABLED）→ 200 `{ disabled: true }`
 *
 * 无状态：服务端不存挑战，token 自带签名（见 lib/auth/captcha.ts）。
 * 公开端点（未登录可访问），已加入 middleware PUBLIC_PATHS。
 */

import { NextResponse } from 'next/server';
import { issueCaptcha, isCaptchaEnabled } from '@/lib/auth/captcha';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!isCaptchaEnabled()) {
    return NextResponse.json({ disabled: true });
  }
  const { question, token } = issueCaptcha();
  // 不缓存：每次刷新一道新题。
  return NextResponse.json(
    { question, token },
    { headers: { 'cache-control': 'no-store' } }
  );
}
