/**
 * 行动项中心（V28）——跨该用户所有未删除记录，从 raw_content 实时解析 Markdown 待办，
 * 聚合展示「未完成 / 已完成」。每项可勾选完成（持久化到 todo_completions，不改 raw_content），
 * 可点击跳到来源记录。空状态友好。
 *
 * 服务端先取数（按 user_id 过滤、排除 deleted_at）首屏直出，交给 client 组件做乐观勾选交互。
 */

import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getTodoLists } from '@/features/todos/store';
import TodoList from '@/features/todos/components/TodoList';
import { PageShell } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '行动项 · 小M' };

export default async function TodosPage() {
  const user = await getCurrentUser();
  // 未登录：中间件通常已拦截，这里仅类型与降级兜底。
  const lists = user
    ? await getTodoLists(getDb(), user.id)
    : { open: [], done: [] };

  return (
    <PageShell width="wide">
      <header className="mb-5 lg:mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          行动项
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          语音速记 / 会议记录总结后的待办，自动聚合到这里，勾掉即完成。
        </p>
      </header>

      <TodoList initialOpen={lists.open} initialDone={lists.done} />
    </PageShell>
  );
}
