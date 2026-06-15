/**
 * POST /api/register —— 邮箱 + 密码注册（注册门禁加固）
 *
 * 契约：JSON `{ email, password, inviteCode?, captchaToken?, captchaAnswer?, agree? }`
 *   - 成功 → 200 `{ ok: true, needsVerification: true }`（已建未验证用户 + 发出验证邮件）
 *   - 失败 → 4xx `{ error, code? }`（code 供前端/旧客户端识别特定场景）
 *
 * 门禁（注册门禁加固，让注册可安全开放）：
 *   0) REGISTRATION_MODE：closed → 403；invite → 必须带有效邀请码；open → 免码。
 *   1) 必选同意条款：agree !== true → 拒绝（前端已强制勾选；服务端兜底）。
 *   2) 验证码（可选增强）：启用时校验签名算术挑战；邀请制已挡机器人，故为次要防线。
 *   3) 基础校验：邮箱格式 + 密码 ≥ 8 位。
 *   4) 邮箱占用：已存在且**有** password_hash → 409；存在但无密码（老魔法链接/Apple）→ 补设密码。
 *   5) 新用户：建 email_verified=false 用户 → 发验证邮件；邀请制下**仅在建号成功后**消费邀请码。
 *
 * 登录门禁配套：email_verified=false 的用户在凭证登录时被拒（见 lib/auth/config.ts），
 *   需点验证邮件里的链接（GET /api/verify-email）置 true 后方可登录；可经
 *   POST /api/resend-verification 重发。Apple 登录视为已验证。
 *
 * 旧 iOS 兼容：iOS 登录复用 Web /login 页（WKWebView 远程加载，恒取最新表单，自带邀请码/验证码字段）。
 *   若有**旧/外部客户端**仍以 `{email,password}` 直 POST 本端点：
 *   - invite 模式缺码 → 返回 403 `{ code:'INVITE_REQUIRED', error: '请前往网页注册…' }` 明确引导；
 *   - open 模式 → 仍可注册（但需邮箱验证后才能登录）。
 *
 * 安全：bcrypt(cost=12)；**绝不存明文 / 绝不打印密码 / token**；内存级限频。
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { DrizzleMinimalAdapter } from '@/lib/auth/adapter';
import {
  hashPassword,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password';
import { getRegistrationMode, consumeInviteCode } from '@/lib/auth/registration';
import {
  issueAndSendVerification,
  canSendVerification,
} from '@/lib/auth/verification';
import { verifyCaptcha, isCaptchaEnabled } from '@/lib/auth/captcha';
import { hitRateLimit, clientIp } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 注册限频：同一 IP 1 分钟内最多 10 次尝试（进程重启即清零）。 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

export async function POST(req: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }

  if (hitRateLimit('register', clientIp(req), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  // ---- 解析输入（绝不打印 password / token）----
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const get = (k: string): unknown =>
    body && typeof body === 'object' && k in body
      ? (body as Record<string, unknown>)[k]
      : undefined;

  const email =
    typeof get('email') === 'string' ? (get('email') as string).trim().toLowerCase() : '';
  const password = typeof get('password') === 'string' ? (get('password') as string) : '';
  const inviteCode =
    typeof get('inviteCode') === 'string' ? (get('inviteCode') as string).trim() : '';
  const agree = get('agree') === true;
  const captchaToken = get('captchaToken');
  const captchaAnswer = get('captchaAnswer');

  // ---- 0) 注册模式闸门 ----
  const mode = getRegistrationMode();
  if (mode === 'closed') {
    return NextResponse.json(
      { error: '注册当前已关闭', code: 'REGISTRATION_CLOSED' },
      { status: 403 }
    );
  }

  // ---- 1) 必选同意条款（服务端兜底，前端已强制勾选）----
  if (!agree) {
    return NextResponse.json(
      { error: '请阅读并同意《用户协议》和《隐私政策》', code: 'CONSENT_REQUIRED' },
      { status: 400 }
    );
  }

  // ---- 2) 验证码（可选增强；启用时校验）----
  if (isCaptchaEnabled() && !verifyCaptcha(captchaToken, captchaAnswer)) {
    return NextResponse.json(
      { error: '验证码错误或已过期，请重试', code: 'CAPTCHA_FAILED' },
      { status: 400 }
    );
  }

  // ---- 3) 基础校验 ----
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `密码至少需要 ${MIN_PASSWORD_LENGTH} 位` },
      { status: 400 }
    );
  }

  // ---- 邀请制：缺码先行拦截（含旧客户端引导）----
  if (mode === 'invite' && !inviteCode) {
    return NextResponse.json(
      {
        error: '注册需要邀请码，请前往网页注册页填写邀请码',
        code: 'INVITE_REQUIRED',
      },
      { status: 403 }
    );
  }

  try {
    const db = getDb();
    const [existing] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // 用后即弃，绝不落库/日志原文。
    const passwordHash = await hashPassword(password);

    // ===== 分支 A：邮箱已存在 =====
    if (existing) {
      if (existing.passwordHash) {
        // 已是完整密码账户 → 拒绝重复注册。
        return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 });
      }
      // 老魔法链接 / Apple 用户：补设密码（不覆盖其它列）。
      // 邀请码：此类账户已是既有用户，**不消费**邀请码（仅是补一个登录方式）。
      await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));

      // 若该既有账户尚未验证邮箱（理论上 Apple/magic-link 已验证），补发一封验证邮件。
      if (!existing.emailVerified) {
        await trySendVerification(existing.id, email);
        return NextResponse.json({ ok: true, needsVerification: true });
      }
      // 既有且已验证：补设密码后即可直接用密码登录。
      return NextResponse.json({ ok: true, needsVerification: false });
    }

    // ===== 分支 B：新用户 =====
    // 邀请制：先**原子消费**邀请码；失败（无效/过期/用尽）则拒绝、不建号。
    if (mode === 'invite') {
      const consumed = await consumeInviteCode(inviteCode);
      if (!consumed) {
        return NextResponse.json(
          { error: '邀请码无效、已过期或已被使用', code: 'INVITE_INVALID' },
          { status: 403 }
        );
      }
    }

    // 复用 adapter.createUser（内含建一行默认 profile）；emailVerified=null → 建 email_verified=false。
    const adapter = DrizzleMinimalAdapter();
    if (!adapter.createUser) {
      return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
    }
    const created = await adapter.createUser({
      id: '',
      email,
      emailVerified: null, // 邮箱+密码注册：未验证，待点验证链接。
    });
    await db.update(users).set({ passwordHash }).where(eq(users.id, created.id));

    // 发验证邮件（失败不回滚建号：用户可在登录页重发验证）。
    await trySendVerification(created.id, email);

    return NextResponse.json({ ok: true, needsVerification: true });
  } catch {
    // 不泄露内部错误细节，也不打印 password / token。
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}

/**
 * 尽力发送验证邮件：未配置发信 / 发信异常都**不致注册失败**（用户可在登录页重发）。
 * 绝不打印 token / 邮箱明文。
 */
async function trySendVerification(userId: string, email: string): Promise<void> {
  if (!canSendVerification()) return;
  try {
    await issueAndSendVerification({ userId, email });
  } catch {
    // 吞掉发信错误：注册仍算成功，前端提示「若没收到可重发」。
  }
}
