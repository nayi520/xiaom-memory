/**
 * 知识库问答页（F · P6 RAG）
 * 顶部说明 + 问答框：输入问题 → 基于检索的回答（Markdown）+ 来源卡片（点击进概念详情）。
 * 鉴权由中间件统一处理（未登录跳 /login）；实际作答在 POST /api/ask 内严格按 userId 检索。
 */

import { PageShell } from '@/components/ui';
import AskBox from '@/features/ask/components/AskBox';

export const metadata = { title: '问答 · 小M' };

export default function AskPage() {
  return (
    <PageShell width="reading">
      <header className="mb-5 lg:mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          问知识库
        </h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-zinc-500 lg:mt-2 lg:text-base dark:text-zinc-400">
          基于你记录并整理过的内容作答，并注明来源。库里没有的，它会如实说不知道，不会编造。
        </p>
      </header>

      <AskBox />
    </PageShell>
  );
}
