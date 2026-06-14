import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getLibraryTree } from '@/features/library/tree';

export const dynamic = 'force-dynamic';

/**
 * GET /api/library/tree —— 知识库四层下钻树（JSON，供 iOS 原生端用）
 *
 * 契约：{ domains: [{ name, topics: [{ name, concepts: [{ id, title, noteCount }] }] }] }
 *   领域 → 主题 → 概念（概念层带 noteCount = 关联且未软删的原始记录数）。
 *   第四层「原始记录」由 GET /api/library/concept/{id} 提供。
 *   领域/主题为空的概念归入「未分类」组（与 PWA 页面口径一致）。
 *
 * 复用 features/library/tree.ts 的 getLibraryTree（与 /library 页下钻取数同口径）。
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const domains = await getLibraryTree(getDb(), user.id);
  return NextResponse.json({ domains });
}
