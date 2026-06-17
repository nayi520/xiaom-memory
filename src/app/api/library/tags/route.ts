import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { listTagsWithCount } from '@/features/library/tags';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/tags —— 标签清单（JSON，供 iOS 标签 chips 用，web 也可用）
 *
 * 契约：{ tags: [{ id, name, count }] }
 *   - count = 经 note_tags 关联、且未软删（notes.deleted_at is null）的去重记录数。
 *   - 按 count 降序、再按名称（zh-CN）排序。
 *
 * 复用 features/library/tags.ts 的 listTagsWithCount（纯读、零 LLM）。
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 * 降级：未登录 → 401；未配 DATABASE_URL → 空数组（不崩溃）。
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
