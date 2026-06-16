/**
 * 管理员直接建号 —— 适合 2-3 人熟人小圈子（免邀请码、免邮箱验证）
 *
 * 鉴权：Authorization: Bearer ${ADMIN_SECRET}（env）。与 /api/admin/invite 完全一致：
 *   缺 ADMIN_SECRET → 500；header 不匹配 → 401（常量时间比较）。
 * 公开路径（middleware PUBLIC_PATHS 已含 /api/admin 前缀），靠端点自身 Bearer 守卫。
 *
 * —— POST /api/admin/users：直接开通一个预验证账号 ——
 *   body JSON `{ email, password?, name? }`
 *     - email     必填；归一化小写 + 格式校验。
 *     - password  可选；提供则 ≥ MIN_PASSWORD_LENGTH，否则服务端生成强随机密码（crypto，16 位）。
 *     - name      可选；trim 后 1–24 字符（与 /api/profile 同口径），非法 → 400。
 *   行为：bcrypt 哈希密码 → 复用 adapter.createUser 建 users + 默认 profile → 显式置
 *     email_verified=true（预验证，绕过邀请码 / 验证码 / 邮箱验证），name 有则落库。
 *   → 200 `{ ok:true, userId, email, password? }`
 *        （password **仅在「服务端生成」时回显一次**供管理员转交；用户自带密码时不回显）
 *   → 409 `{ error:'该邮箱已注册' }`  邮箱已存在
 *   → 400 `{ error }`                请求体 / 邮箱 / 密码 / name 校验失败
 *   → 401 / 500 / 503               鉴权失败 / 未配 secret / 库不可用
 *
 * —— GET /api/admin/users：列出已开通账号（便于管理小圈子）——
 *   → 200 `{ ok:true, count, users:[{ email, name, emailVerified, createdAt }] }`
 *        **绝不含任何哈希 / 密码**。
 *
 * 安全红线：**绝不打印 / 日志 password 或 hash**；明文用后即弃，仅一次性回传。
 *
 * 与 REGISTRATION_MODE 配合：纯「管理员建号」模式 = 设 REGISTRATION_MODE=closed
 *   （/api/register 直接 403 关闭公开注册）+ 用本端点开号。预验证账号 email_verified=true，
 *   走既有凭证登录可直接登入，无需邮箱验证。
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { DrizzleMinimalAdapter } from '@/lib/auth/adapter';
import {
  hashPassword,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  generateStrongPassword,
} from '@/lib/auth/password';
import { normalizeName, NAME_MIN, NAME_MAX } from '@/lib/profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 常量时间比较 Bearer 凭证（与 /api/admin/invite 等价的鉴权语义）。
 * 缺 ADMIN_SECRET → 返回 500 响应；不匹配 → 401；通过 → null（放行）。
 * 用 timingSafeEqual 防时序侧信道；先比长度再比内容（长度不同直接判否，等长才进比较）。
 */
function guardAdmin(req: Request): NextResponse | null {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 ADMIN_SECRET' }, { status: 500 });
  }
  const provided = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
  }
  return null;
}

export async function POST(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }

  // ---- 解析输入（绝不打印 password / hash）----
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
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }

  // password：提供则校验长度；省略则服务端生成强随机密码（仅此时在响应回显一次）。
  const rawPassword = get('password');
  let password: string;
  let generated = false;
  if (rawPassword === undefined || rawPassword === null || rawPassword === '') {
    password = generateStrongPassword();
    generated = true;
  } else if (typeof rawPassword === 'string') {
    if (rawPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `密码至少需要 ${MIN_PASSWORD_LENGTH} 位` },
        { status: 400 }
      );
    }
    password = rawPassword;
  } else {
    return NextResponse.json({ error: '密码格式不正确' }, { status: 400 });
  }

  // name：可选；提供则按 1–24 字符校验，非法 → 400。
  const rawName = get('name');
  let name: string | null = null;
  if (rawName !== undefined && rawName !== null && rawName !== '') {
    name = normalizeName(rawName);
    if (name === null) {
      return NextResponse.json(
        { error: `显示名需为 ${NAME_MIN}–${NAME_MAX} 个字符` },
        { status: 400 }
      );
    }
  }

  try {
    const db = getDb();
    // 用后即弃，绝不落库 / 日志原文。
    const passwordHash = await hashPassword(password);

    // 复用 adapter.createUser（内含建一行默认 profile）；传入非 null emailVerified →
    // 直接建 email_verified=true（预验证），绕过邀请码 / 验证码 / 邮箱验证。
    const adapter = DrizzleMinimalAdapter();
    if (!adapter.createUser) {
      return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
    }
    const created = await adapter.createUser({
      id: '',
      email,
      emailVerified: new Date(), // 非 null → email_verified=true。
    });

    // 落 password_hash（+ name 有则一并）。adapter 不接收 hash/name，故此处补一次更新。
    await db
      .update(users)
      .set(name !== null ? { passwordHash, name } : { passwordHash })
      .where(eq(users.id, created.id));

    return NextResponse.json({
      ok: true,
      userId: created.id,
      email,
      // password 仅在「服务端生成」时回显一次，供管理员转交；用户自带密码时不回显。
      ...(generated ? { password } : {}),
    });
  } catch (err) {
    // 邮箱已存在（users_email_key 唯一冲突）→ 409。不打印 password / hash。
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique|users_email_key/i.test(msg)) {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 });
    }
    return NextResponse.json({ error: '建号失败，请稍后重试' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }

  try {
    const db = getDb();
    // 仅选展示所需列，**绝不含 password_hash 等任何敏感列**。
    const rows = await db
      .select({
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return NextResponse.json({ ok: true, count: rows.length, users: rows });
  } catch {
    return NextResponse.json({ error: '查询失败，请稍后重试' }, { status: 500 });
  }
}
