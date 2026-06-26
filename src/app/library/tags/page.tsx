/**
 * 标签管理（V32）——知识库卫生：总览本人全部标签 + 改名 / 合并 / 删除。
 *
 * 服务端按 tags.user_id 取本人全部标签（带「使用计数」= 未删记录用量，复用 listTagsWithCount），
 * 首屏直出，交给 client 组件 TagManager 做搜索过滤 + 各操作（乐观更新 / 失败回滚 / 确认交互）。
 *
 * 入口：知识库标签筛选区旁「管理标签」+ 设置页「导出与管理」区块。
 * 多租户：所有读写严格本人归属（这里取数、API 写入均显式按 user_id 过滤）。
 */

import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { listTagsWithCount } from '@/features/library/tags';
import TagManager from '@/features/library/components/TagManager';
import { PageShell, ChevronLeft } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '标签管理 · 小M' };

export default async function TagsManagePage() {
  const user = await getCurrentUser();
  // 未登录：中间件通常已拦截；这里仅降级兜底（空列表）。
  const tags =
    user && isDatabaseConfigured()
      ? await listTagsWithCount(getDb(), user.id)
      : [];

  return (
    <PageShell width="wide">
      <div className="mb-5 lg:mb-6">
        <Link
          href="/library"
          className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 transition hover:text-brand"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
          返回知识库
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          标签管理
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          给知识库做次卫生：合并重复、改正错字、清理不用的标签。改名 / 合并后，筛选链接仍指向新标签。
        </p>
      </div>

      <TagManager initialTags={tags} />
    </PageShell>
  );
}
