'use client';

import { useState } from 'react';
import type { DigestResult } from '../pipeline';

type State =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: DigestResult }
  | { phase: 'error'; message: string };

/** 设置页"立即整理"按钮：手动触发当前用户的 AI 整理流水线 */
export default function DigestNowButton() {
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function run() {
    setState({ phase: 'running' });
    try {
      const res = await fetch('/api/digest/run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setState({ phase: 'error', message: data.error ?? `请求失败（${res.status}）` });
        return;
      }
      setState({ phase: 'done', result: data.result as DigestResult });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : '网络错误',
      });
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={state.phase === 'running'}
        className="w-full rounded-xl bg-brand py-3 font-semibold text-white transition active:opacity-80 disabled:opacity-50"
      >
        {state.phase === 'running' ? '整理中…（可能需要 1–2 分钟）' : '立即整理'}
      </button>

      {state.phase === 'done' && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <p className="font-medium">整理完成（{state.result.period}）</p>
          <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-300">
            <li>处理记录：{state.result.notesProcessed} / {state.result.notesTotal}</li>
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
        </div>
      )}

      {state.phase === 'error' && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {state.message}
        </p>
      )}
    </div>
  );
}
