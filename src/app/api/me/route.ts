import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { signAvatarUrl } from '@/lib/profile';

// 头像现签需 ali-oss（Node SDK）+ 查库，固定 Node runtime、禁缓存。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/me —— 当前登录用户视图（去 Supabase 改造 · 增用户资料）
 *
 * 取代浏览器端 supabase.auth.getUser()：客户端需要 user.id / 资料时请求本端点。
 * 返回 { id, email, name, avatarUrl }：
 *   - name：显示名（users.name，未设为 null）。
 *   - avatarUrl：对 users.avatar_key 现签的 OSS 临时 URL（~1h，客户端勿长期缓存），
 *     未设头像 / 取地址失败时为 null（降级，不让整个端点失败）。
 * 未登录返回 401。
 *
 * 授权：avatar_key 形如 `avatars/{userId}/...`，签名前校验其归属当前用户（防越权，见 signAvatarUrl）。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 查库取资料列（name / avatar_key）。查库失败时退化为仅 id/email（不阻断登录态读取）。
  let name: string | null = null;
  let avatarKey: string | null = null;
  try {
    const rows = await getDb()
      .select({ name: users.name, avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    name = rows[0]?.name ?? null;
    avatarKey = rows[0]?.avatarKey ?? null;
  } catch (err) {
    console.error('[me] 读取用户资料失败：', err);
  }

  const avatarUrl = await signAvatarUrl(user.id, avatarKey);

  return NextResponse.json({ id: user.id, email: user.email, name, avatarUrl });
}
