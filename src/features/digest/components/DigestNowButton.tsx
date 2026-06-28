'use client';

import { useState } from 'react';
import type { DigestResult } from '../pipeline';
import { Button, useToast } from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

type State =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: DigestResult };

/** 设置页"立即整理"按钮：手动触发当前用户的 AI 整理流水线 */
export default function DigestNowButton() {
  const { error: toastError } = useToast();
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function run() {
    setState({ phase: 'running' });
    try {
      const res = await apiFetch('/api/digest/run', { method: 'POST', timeoutMs: LONG_TIMEOUT_MS });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? `请求失败（${res.status}）`);
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'done', result: data.result as DigestResult });
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
      setState({ phase: 'idle' });
    }
  }

  return (
    <div className="space-y-3">
      <Button
        size="lg"
        fullWidth
        onClick={run}
        loading={state.phase === 'running'}
      >
        {state.phase === 'running' ? '整理中…（可能需要 1–2 分钟）' : '立即整理'}
      </Button>

      {state.phase === 'done' && (
        <div className="animate-fade-in rounded-card border border-zinc-200/80 bg-zinc-50 p-4 text-sm shadow-card dark:border-zinc-700 dark:bg-zinc-800/60">
          {state.result.notesTotal === 0 ? (
            <p className="font-semibold text-zinc-800 dark:text-zinc-100">
              没有待整理的记录，知识库已是最新
            </p>
          ) : (
            <>
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                整理了 {state.result.notesProcessed} 条 → 新增 {state.result.conceptsCreated} 概念 / {state.result.cardsCreated} 卡片
              </p>
              <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-300">
                <li>处理记录：{state.result.notesProcessed} / {state.result.notesTotal}（含往日积压）</li>
                <li>新概念：{state.result.conceptsCreated} ｜ 新卡片：{state.result.cardsCreated}</li>
                <li>新关联：{state.result.linksCreated} ｜ 日报：{state.result.digestSaved ? '已生成' : '未生成'}</li>
                {state.result.notesNeedsReview > 0 && (
                  <li className="text-amber-600 dark:text-amber-400">
                    {state.result.notesNeedsReview} 条整理失败，已标记待人工处理
                  </li>
                )}
                {state.result.errors.length > 0 && (
                  <li className="text-zinc-400">提示：{state.result.errors.join('；')}</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
