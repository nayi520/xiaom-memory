import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts, profiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * 概念收藏 / 置顶（V15）—— 存 profiles.settings.favoriteConcepts（string[]），无迁移。
 *
 * GET  /api/library/favorite → { favorites: string[] }（当前收藏的概念 id；不存在/非数组回 []）。
 * POST /api/library/favorite { conceptId, favorite: boolean } → { ok: true, favorites }
 *   - favorite=true ：加入收藏（须为本人概念，他人/不存在 → 404）。
 *   - favorite=false：移出收藏（幂等：本就不在也回 ok）。
 *
 * 写入复用 settings 的 upsert + jsonb 合并：把整段 favoriteConcepts 数组并入 settings，
 * 不覆盖 settings 内其它键（reminderHour / reviewDailyGoal / onboarded 等）。
 *
 * 鉴权 getCurrentUser()，授权应用层——按 user.id 读写 profiles；概念归属按 user_id 校验。
 */

/** 从 settings 收敛出 favoriteConcepts（缺省/非数组回 []，元素取字符串去重）。 */
function resolveFavorites(settings: unknown): string[] {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).favoriteConcepts
      : undefined;
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((v): v is string => typeof v === 'string')));
}

async function readFavorites(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ settings: profiles.settings })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return resolveFavorites(rows[0]?.settings);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  try {
    return NextResponse.json({ favorites: await readFavorites(user.id) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `读取收藏失败：${msg}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let body: { conceptId?: unknown; favorite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const conceptId = typeof body.conceptId === 'string' ? body.conceptId : null;
  if (!conceptId) {
    return NextResponse.json({ error: '缺少 conceptId' }, { status: 400 });
  }
  const favorite =
    typeof body.favorite === 'boolean'
      ? body.favorite
      : body.favorite === 'true'
        ? true
        : body.favorite === 'false'
          ? false
          : null;
  if (favorite === null) {
    return NextResponse.json({ error: 'favorite 必须是布尔值' }, { status: 400 });
  }

  const db = getDb();

  // 收藏时校验概念归属（取消收藏不强求，便于清理已删概念的残留 id）。
  if (favorite) {
    const owned = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.id, conceptId), eq(concepts.userId, user.id)))
      .limit(1);
    if (!owned[0]) {
      return NextResponse.json({ error: '概念不存在' }, { status: 404 });
    }
  }

  try {
    const current = await readFavorites(user.id);
    const set = new Set(current);
    if (favorite) set.add(conceptId);
    else set.delete(conceptId);
    const next = Array.from(set);

    // upsert + jsonb 合并：整段 favoriteConcepts 数组并入 settings，不覆盖其它键。
    const patch = sql`jsonb_build_object('favoriteConcepts', ${JSON.stringify(next)}::jsonb)`;
    await db
      .insert(profiles)
      .values({ id: user.id, email: user.email, settings: patch })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { settings: sql`${profiles.settings} || ${patch}` },
      });

    return NextResponse.json({ ok: true, favorites: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `收藏保存失败：${msg}` }, { status: 500 });
  }
}
