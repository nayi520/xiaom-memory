'use client';

/**
 * 设置页「本周周报」面板（P5）：
 *   - 挂载时 GET /api/digest/weekly 拉取最新周报并以 Markdown 展示
 *   - 「生成本周周报」按钮 POST /api/digest/run-weekly 手动触发，成功后刷新展示
 *
 * 周报由每日简报 + 本周新概念汇总而成；本周无沉淀时后端返回 ok=false，前端提示「本周还没有可汇总的内容」。
 * 复用设计系统 ui 组件，错误（含 503 无 key）友好提示、不崩溃。
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Markdown, useToast, cn } from '@/components/ui';

interface WeeklyDigest {
  period: string;
  content: string;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; digest: WeeklyDigest | null }
  | { phase: 'error'; message: string };

type GenState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'empty'; period: string };

export default function WeeklyDigestPanel() {
  const { error: toastError } = useToast();
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [gen, setGen] = useState<GenState>({ phase: 'idle' });

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch('/api/digest/weekly');
      const data = await res.json();
      if (!res.ok) {
        setLoad({ phase: 'error', message: data?.error ?? `加载失败（${res.status}）` });
        return;
      }
      setLoad({ phase: 'ready', digest: (data?.digest ?? null) as WeeklyDigest | null });
    } catch (err) {
      setLoad({
        phase: 'error',
        message: err instanceof Error ? err.message : '网络错误',
      });
    }
  }, []);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  async function generate() {
    setGen({ phase: 'running' });
    try {
      const res = await fetch('/api/digest/run-weekly', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toastError(data?.error ?? `生成失败（${res.status}）`);
        setGen({ phase: 'idle' });
        return;
      }
      if (!data?.ok) {
        setGen({ phase: 'empty', period: data?.period ?? '' });
        return;
      }
      setGen({ phase: 'idle' });
      await fetchLatest();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
      setGen({ phase: 'idle' });
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={generate}
        loading={gen.phase === 'running'}
      >
        {gen.phase === 'running' ? '汇总本周…（可能需要一会儿）' : '生成本周周报'}
      </Button>

      {gen.phase === 'empty' && (
        <p className="animate-fade-in text-sm text-zinc-500 dark:text-zinc-400">
          本周还没有可汇总的内容——先记录几条、让 AI 整理后再来生成。
        </p>
      )}

      {load.phase === 'ready' && load.digest && (
        <article
          className={cn(
            'animate-fade-in rounded-card border border-zinc-200/80 bg-white p-5 shadow-card dark:border-zinc-800 dark:bg-zinc-900'
          )}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            最新周报 · {load.digest.period}
          </p>
          <Markdown content={load.digest.content} className="text-[15px]" />
        </article>
      )}

      {load.phase === 'ready' && !load.digest && gen.phase === 'idle' && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          还没有周报。本周有记录后，点上面的按钮即可生成。
        </p>
      )}

      {load.phase === 'error' && (
        <p className="text-sm text-zinc-400">周报加载失败：{load.message}</p>
      )}
    </div>
  );
}
