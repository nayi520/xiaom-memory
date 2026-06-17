'use client';

/**
 * 「生成学习指南」入口（V16 AI 增强）——用于知识库领域视图。
 * 点击 POST /api/study-guide { domain } → AI 据该领域全部概念生成结构化 Markdown 学习指南，
 * 内联展开展示（可关闭）。429/503/404 等错误友好提示、不崩溃。
 *
 * 也支持传 conceptIds（按概念集生成）；领域视图传 domain。
 */

import { useState } from 'react';
import { Button, Markdown, AiIcon, CloseIcon, useToast, cardClass, cn } from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

interface Props {
  domain?: string;
  conceptIds?: string[];
  /** 按钮文案（默认「生成学习指南」）。 */
  label?: string;
  /** 按钮尺寸/样式（透传给 ui Button）。 */
  size?: 'sm' | 'md' | 'lg';
}

export default function StudyGuideButton({
  domain,
  conceptIds,
  label = '生成学习指南',
  size = 'sm',
}: Props) {
  const { error: toastError } = useToast();
  const [running, setRunning] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);

  async function generate() {
    setRunning(true);
    try {
      const res = await apiFetch('/api/study-guide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          conceptIds && conceptIds.length > 0 ? { conceptIds } : { domain }
        ),
        timeoutMs: LONG_TIMEOUT_MS, // AI 生成可能数十秒
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data?.error ?? `生成失败（${res.status}）`);
        return;
      }
      setMarkdown(typeof data?.markdown === 'string' ? data.markdown : '');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" size={size} onClick={generate} loading={running}>
        <AiIcon aria-hidden className="h-4 w-4" />
        {running ? '生成中…' : label}
      </Button>

      {markdown !== null && (
        <article
          className={cn(
            'animate-fade-in',
            cardClass({ padded: false }),
            'relative px-5 py-4'
          )}
        >
          <button
            type="button"
            onClick={() => setMarkdown(null)}
            className="absolute right-3 top-3 rounded-md p-1 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label="关闭学习指南"
          >
            <CloseIcon aria-hidden className="h-4 w-4" />
          </button>
          {markdown.trim() ? (
            <Markdown content={markdown} className="text-[15px]" />
          ) : (
            <p className="text-sm text-zinc-400">没有生成内容，请稍后重试。</p>
          )}
        </article>
      )}
    </div>
  );
}
