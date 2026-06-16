import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import {
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password';

// 查/写库（bcrypt 哈希、读 password_hash），固定 Node runtime、禁缓存。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/profile/password —— 自助修改 / 设置密码（账户安全）
 *
 * 登录用户（含管理员建号者）自行改密码。鉴权照抄 /api/profile：getCurrentUser()，未登录 401。
 *
 * body `{ currentPassword?: string, newPassword: string }`：
 *   - newPassword 校验：trim 前长度 ≥ MIN_PASSWORD_LENGTH 且 ≠ currentPassword；否则 400 {error}。
 *   - 该用户**有** password_hash（邮箱+密码账户）：currentPassword 必填且需 bcrypt 比对正确
 *     （复用登录同款 verifyPassword），错 → 400 {error:'当前密码不正确'}。
 *   - 该用户**无** password_hash（仅 Apple / magic-link）：允许**不带 currentPassword 直接设新密码**
 *     （已凭会话登录，等价于「设置密码」）。
 *   - 通过后：bcrypt(cost=12) 哈希 newPassword → update users.password_hash where id=user.id，返回 200 {ok:true}。
 *
 * 安全红线：**绝不打印 / 日志任何密码**（仅记录非密码相关的库错误）。比对/哈希全走 password.ts。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 密码不做 trim（首尾空白也是有效字符）；仅取字符串，非字符串视为缺省。
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  // —— 新密码基础校验（不泄露任何明文）——
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位` },
      { status: 400 }
    );
  }
  if (currentPassword && newPassword === currentPassword) {
    return NextResponse.json(
      { error: '新密码不能与当前密码相同' },
      { status: 400 }
    );
  }

  // —— 读当前 password_hash（getCurrentUser 只给 id/email，须自查库；按 user.id 隔离）——
  let passwordHash: string | null;
  try {
    const [row] = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row) {
      // 会话有效但库里查不到该用户（极端边界）。
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    passwordHash = row.passwordHash;
  } catch (err) {
    console.error('[profile/password] 读取账户失败：', err);
    return NextResponse.json({ error: '操作失败，请稍后重试' }, { status: 500 });
  }

  // —— 有密码的账户：必须校验当前密码（复用登录同款 bcrypt 比对，恒定时间）——
  if (passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: '请输入当前密码' }, { status: 400 });
    }
    const ok = await verifyPassword(currentPassword, passwordHash);
    if (!ok) {
      return NextResponse.json({ error: '当前密码不正确' }, { status: 400 });
    }
  }
  // 无密码账户（Apple / magic-link）：已凭会话登录 → 允许不带 currentPassword 直接设新密码。

  // —— 哈希新密码并落库（明文用后即弃，绝不日志）——
  try {
    const nextHash = await hashPassword(newPassword);
    await getDb()
      .update(users)
      .set({ passwordHash: nextHash })
      .where(eq(users.id, user.id));
  } catch (err) {
    console.error('[profile/password] 保存密码失败：', err);
    return NextResponse.json({ error: '密码保存失败，请稍后重试' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
