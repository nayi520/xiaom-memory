/**
 * POST /api/register —— 邮箱 + 密码注册（V1 鉴权）
 *
 * 契约：JSON `{ email, password }`
 *   - 成功 → 200 `{ ok: true }`
 *   - 失败 → 4xx `{ error }`
 *
 * 逻辑（email 大小写归一化为小写）：
 *   1) 校验：邮箱格式 + 密码 ≥ 8 位；
 *   2) email 已存在且**有** password_hash → 409「该邮箱已注册」；
 *   3) email 存在但**无** password_hash（老魔法链接 / Apple 用户）→ 补设 password_hash；
 *   4) email 不存在 → 走 adapter.createUser（同步建 profile）+ 设 password_hash。
 *
 * 安全：bcrypt(cost=12) 哈希；**绝不存明文、绝不打印密码**；基本防滥用（内存级限频）。
 * 注册成功后由前端再调 signIn('credentials') 完成登录（见 /login 页）。
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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 极简内存级防滥用：同一 IP 在窗口内限若干次注册尝试。
 * 单实例自用足够；多实例 / 严格限频后续可换 Redis。进程重启即清零。
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 分钟
const RATE_LIMIT_MAX = 10; // 每窗口最多 10 次
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT_MAX;
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  // ---- 解析 + 校验输入（绝不打印 password）----
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
  const passwordRaw =
    body && typeof body === 'object' && 'password' in body
      ? (body as { password?: unknown }).password
      : undefined;

  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `密码至少需要 ${MIN_PASSWORD_LENGTH} 位` },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // 用后即弃，绝不落库/日志原文。
    const passwordHash = await hashPassword(password);

    if (existing) {
      if (existing.passwordHash) {
        // 已是完整密码账户 → 拒绝重复注册。
        return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 });
      }
      // 老魔法链接 / Apple 用户：补设密码（不覆盖其它列）。
      await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, existing.id));
      return NextResponse.json({ ok: true });
    }

    // 新用户：复用 adapter.createUser（内含建一行默认 profile），再写 password_hash。
    const adapter = DrizzleMinimalAdapter();
    // createUser 在最小适配器里必有实现；类型上为可选，做存在性收窄。
    if (!adapter.createUser) {
      return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
    }
    const created = await adapter.createUser({
      // 适配器忽略传入 id（库内 defaultRandom），emailVerified 仅占位。
      id: '',
      email,
      emailVerified: null,
    });
    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, created.id));

    return NextResponse.json({ ok: true });
  } catch {
    // 不泄露内部错误细节，也不打印 password。
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}
