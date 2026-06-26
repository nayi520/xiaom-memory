import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { listTagsWithCount } from '@/features/library/tags';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tags —— 标签管理总览（V32 标签管理）。
 *
 * 契约：{ tags: [{ id, name, count }] }
 *   - count = 经 note_tags 关联、且未软删（notes.deleted_at is null）的去重记录数（=「使用计数」）。
 *   - 按 count 降序、再按名称（zh-CN）排序（与 /api/library/tags 同口径，复用 listTagsWithCount）。
 *   - 含 count=0 的孤儿标签（管理页要能看到并清理它们）。
 *
 * 鉴权 getCurrentUser()，授权严格按 tags.user_id 过滤（多租户：只返回本人标签）。
 * 降级：未登录 → 401；未配 DATABASE_URL → 空数组（不崩溃）。
 *
 * 注：与既有 /api/library/tags 同形契约，但语义独立（管理页用），便于将来分别演进。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ tags: [] });
  }

  const tags = await listTagsWithCount(getDb(), user.id);
  return NextResponse.json({ tags });
}
