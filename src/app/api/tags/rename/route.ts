import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { tags as tagsTable } from '@/lib/db/schema';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { planTagRename, type ExistingTag } from '@/features/library/tag-ops';
import { mergeTagsTx } from '@/features/library/tag-merge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tags/rename —— 重命名标签；命中同名则自动合并（V32 标签管理）。
 *
 * body: { tagId: string, name: string }
 *   归一化新名（去首尾空白/前导#/折叠空白），按是否撞已有标签分三种：
 *     - noop  ：与原名相同 → 不写库，返回 action:'noop'。
 *     - rename：新名未被占用 → UPDATE tags.name（受 (user_id,name) 唯一约束保护）。
 *     - merge ：新名已属**另一个**标签 → 把本标签 note_tags 重指到那个标签、去重、删本标签
 *               （事务，见 mergeTagsTx）。前端据此提示「将合并到已有标签 X」。
 *
 * 契约（200）：
 *   { ok:true, action:'noop'|'rename'|'merge', name, tagId, mergedInto?:string }
 *     - rename/noop：tagId 为本标签（名已是 name）。
 *     - merge：tagId 为**目标**标签 id，mergedInto 同值；本标签已删除。
 *   400 参数非法（缺 tagId / 名非法）；401 未登录；404 标签不存在或非本人；429 限流。
 *
 * 鉴权 getCurrentUser()，授权严格按 tags.user_id 过滤（多租户）。合并走单事务保证一致。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 轻量限流：标签写操作复用通用「export」低频闸（正常人不会一分钟改名很多次）。
  const rl = enforceAiRateLimit(user.id, 'export');
  if (!rl.ok) {
    return NextResponse.json(
      { error: `操作过于频繁，请 ${rl.retryAfter}s 后再试` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  let body: { tagId?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const tagId = typeof body.tagId === 'string' ? body.tagId.trim() : '';
  if (!tagId) {
    return NextResponse.json({ error: '缺少 tagId' }, { status: 400 });
  }
  if (typeof body.name !== 'string') {
    return NextResponse.json({ error: '缺少 name' }, { status: 400 });
  }

  const db = getDb();

  // 取本人全部标签（用于改名→是否撞同名判定，并顺带做归属校验）。
  const owned: ExistingTag[] = await db
    .select({ id: tagsTable.id, name: tagsTable.name })
    .from(tagsTable)
    .where(eq(tagsTable.userId, user.id));

  if (!owned.some((t) => t.id === tagId)) {
    return NextResponse.json({ error: '标签不存在' }, { status: 404 });
  }

  const plan = planTagRename(tagId, body.name, owned);
  if (!plan.name) {
    return NextResponse.json({ error: '标签名不能为空' }, { status: 400 });
  }

  if (plan.action === 'noop') {
    return NextResponse.json({ ok: true, action: 'noop', name: plan.name, tagId });
  }

  if (plan.action === 'rename') {
    try {
      await db
        .update(tagsTable)
        .set({ name: plan.name })
        .where(and(eq(tagsTable.id, tagId), eq(tagsTable.userId, user.id)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `改名失败：${msg}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: 'rename', name: plan.name, tagId });
  }

  // action === 'merge'：新名撞到 mergeTargetId，把本标签并入目标后删除本标签。
  const targetId = plan.mergeTargetId!;
  try {
    await mergeTagsTx(db, user.id, targetId, [tagId]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `合并失败：${msg}` }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    action: 'merge',
    name: plan.name,
    tagId: targetId,
    mergedInto: targetId,
  });
}
