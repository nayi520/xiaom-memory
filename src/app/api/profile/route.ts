import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { normalizeName, signAvatarUrl, NAME_MIN, NAME_MAX } from '@/lib/profile';

// 更新后需回签头像 URL（ali-oss/Node SDK）+ 查/写库，固定 Node runtime、禁缓存。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/profile —— 修改显示用户名（用户资料）
 *
 * body { name: string }：trim 后要求 1–24 字符，空/全空白/超长 → 400 {error}。
 * 校验通过后更新 users.name（按 user.id，应用层隔离），
 * 返回 { id, email, name, avatarUrl }（avatarUrl 为现签临时 URL，无头像则 null）。
 * 未登录 401。
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const name = normalizeName(body.name);
  if (name === null) {
    return NextResponse.json(
      { error: `显示名需为 ${NAME_MIN}–${NAME_MAX} 个字符` },
      { status: 400 }
    );
  }

  // 更新 name 并回读 avatar_key（一次往返），按 user.id 隔离。
  let avatarKey: string | null = null;
  try {
    const rows = await getDb()
      .update(users)
      .set({ name })
      .where(eq(users.id, user.id))
      .returning({ avatarKey: users.avatarKey });
    avatarKey = rows[0]?.avatarKey ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `显示名保存失败：${msg}` }, { status: 500 });
  }

  const avatarUrl = await signAvatarUrl(user.id, avatarKey);

  return NextResponse.json({ id: user.id, email: user.email, name, avatarUrl });
}
