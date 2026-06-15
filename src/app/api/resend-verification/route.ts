/**
 * POST /api/resend-verification —— 重发邮箱验证邮件（注册门禁加固）
 *
 * 契约：JSON `{ email }`
 *   - 一律返回 200 `{ ok: true }`（无论邮箱是否存在/是否已验证），**不暴露账户存在性**；
 *     仅对「存在且未验证」的用户实际重发验证邮件。
 *   - 限频（IP + email 双维度）→ 429 `{ error }`。
 *   - 发信未配置 → 503 `{ error }`（明确提示，便于自用时排查）。
 *
 * 公开端点（未登录可访问），已加入 middleware PUBLIC_PATHS。
 * 安全：绝不打印 token / 邮箱明文；不区分失败原因（防枚举）。
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { isValidEmail } from '@/lib/auth/password';
import {
  findUnverifiedUserByEmail,
  issueAndSendVerification,
  canSendVerification,
} from '@/lib/auth/verification';
import { hitRateLimit, clientIp } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 重发限频：同一 IP 每 10 分钟最多 5 次；同一邮箱每 10 分钟最多 3 次。 */
const WINDOW_MS = 10 * 60_000;
const IP_MAX = 5;
const EMAIL_MAX = 3;

export async function POST(req: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }
  if (!canSendVerification()) {
    return NextResponse.json(
      { error: '邮件服务未配置，暂时无法发送验证邮件' },
      { status: 503 }
    );
  }

  if (hitRateLimit('resend-ip', clientIp(req), IP_MAX, WINDOW_MS)) {
    return NextResponse.json({ error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const emailRaw =
    body && typeof body === 'object' && 'email' in body
      ? (body as { email?: unknown }).email
      : undefined;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  if (hitRateLimit('resend-email', email, EMAIL_MAX, WINDOW_MS)) {
    return NextResponse.json({ error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  try {
    const user = await findUnverifiedUserByEmail(email);
    // 仅对「存在且未验证」用户重发；其余静默成功（不暴露账户存在性）。
    if (user) {
      await issueAndSendVerification({ userId: user.id, email: user.email });
    }
  } catch {
    // 发信失败也返回成功外观（避免据错误探测账户）；不打印明文/token。
  }

  return NextResponse.json({ ok: true });
}
