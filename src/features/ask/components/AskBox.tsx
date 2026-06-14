'use client';

/**
 * 知识库问答框（P6）：输入问题 → POST /api/ask → 渲染回答（Markdown）+ 来源卡片。
 * 来源卡片可点击进入对应概念详情页（/library/concept/{id}）。
 *
 * 交互：Enter 提交（Shift+Enter 换行）；加载态禁用并显示 spinner；
 * 错误（含 503 无 key 降级）友好提示，不崩溃。复用设计系统 ui 组件。
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, Textarea, Markdown, cardClass, cn } from '@/components/ui';

interface Source {
  conceptId: string;
  title: string;
  snippet: string;
}

interface AskResponse {
  answer: string;
  sources: Source[];
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'answered'; question: string; result: AskResponse }
  | { phase: 'error'; message: string };

const SUGGESTIONS = [
  '我最近都在关注什么？',
  '帮我回忆一下关于专注力的内容',
  '我记过哪些和决策有关的概念？',
];

export default function AskBox() {
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || state.phase === 'loading') return;
    setState({ phase: 'loading' });
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({
          phase: 'error',
          message: data?.error ?? `请求失败（${res.status}）`,
        });
        return;
      }
      setState({
        phase: 'answered',
        question: trimmed,
        result: data as AskResponse,
      });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : '网络错误，请稍后再试',
      });
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    ask(question);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(question);
    }
  }

  const loading = state.phase === 'loading';

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-3">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="向你的知识库提问，比如「我记过哪些关于习惯养成的概念？」"
          enterKeyHint="send"
          disabled={loading}
          aria-label="问题"
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!question.trim()}
        >
          {loading ? '正在翻你的知识库…' : '提问'}
        </Button>
      </form>

      {state.phase === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 transition hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {state.phase === 'error' && (
        <p
          role="alert"
          className="animate-fade-in rounded-card border border-red-200 bg-red-50 p-3.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {state.message}
        </p>
      )}

      {state.phase === 'answered' && (
        <div className="animate-fade-in space-y-4">
          <div className={cn(cardClass(), 'text-[15px]')}>
            <Markdown content={state.result.answer} />
          </div>

          {state.result.sources.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                来源 · {state.result.sources.length} 个概念
              </p>
              <ul className="space-y-2">
                {state.result.sources.map((s, i) => (
                  <li key={s.conceptId}>
                    <Link
                      href={`/library/concept/${s.conceptId}`}
                      className={cn(
                        cardClass({ interactive: true, padded: false }),
                        'group flex items-start gap-3 px-4 py-3'
                      )}
                    >
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold tabular-nums text-brand">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-zinc-800 dark:text-zinc-100">
                          {s.title}
                        </span>
                        {s.snippet && (
                          <span className="mt-0.5 block truncate text-xs text-zinc-400">
                            {s.snippet}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden
                        className="mt-0.5 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
                      >
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
