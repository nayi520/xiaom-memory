'use client';

import { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { enqueue, isOfflineQueueSupported } from '@/features/offline/queue';
import { Button, Input, SpinnerIcon, LinkIcon, cn } from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

/** 规范化用户输入为可抓取 URL（缺协议补 https://）。 */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** 看起来像个有域名的 URL（用于决定是否值得去取标题，避免对半截输入狂发请求）。 */
function looksLikeUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeUrl(raw));
    return Boolean(u.hostname) && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export default function LinkCapture({
  addOptimistic,
  confirmNote,
  failNote,
  queueNote,
}: CaptureHandlers) {
  const [url, setUrl] = useState('');
  const [why, setWhy] = useState('');
  // 标题预览：链接自动取标题（GET /api/links/meta），仅作录入时的即时反馈。
  const [title, setTitle] = useState<string | null>(null);
  const [titleLoading, setTitleLoading] = useState(false);

  // 防抖：URL 稳定 ~600ms 后取标题；失败/无标题静默（不打扰，剪藏端仍会兜底提取）。
  useEffect(() => {
    const trimmed = url.trim();
    setTitle(null);
    if (!looksLikeUrl(trimmed)) {
      setTitleLoading(false);
      return;
    }
    setTitleLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      // 标题预览：best-effort，401 不弹重登浮层、失败不重试（输入仍可提交）。
      apiFetch(`/api/links/meta?url=${encodeURIComponent(normalizeUrl(trimmed))}`, {
        retries: 0,
        notifyOn401: false,
        timeoutMs: 20_000,
      })
        .then((res) => (res.ok ? res.json() : {}))
        .then((data: { title?: string }) => {
          if (!cancelled) setTitle(data.title?.trim() || null);
        })
        .catch(() => {
          if (!cancelled) setTitle(null);
        })
        .finally(() => {
          if (!cancelled) setTitleLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  // 提交时携带「已取到的标题」作为乐观占位正文，让最近列表立刻显示标题而非裸 URL。
  const titleRef = useRef<string | null>(null);
  titleRef.current = title;

  /** 发一次剪藏请求（首次与「重试」共用；重试会再上屏一条新乐观占位）。 */
  async function submit(target: string, whyImportant: string | null, knownTitle: string | null) {
    const temp = makeTempNote({
      type: 'link',
      url: target,
      // 已知标题则用「# 标题」占位（与剪藏端正文形态一致），否则回退裸 URL。
      raw_content: knownTitle ? `# ${knownTitle}` : target,
      why_important: whyImportant,
      hint: '抓取中…',
    });
    addOptimistic(temp);

    const body = { url: target, why_important: whyImportant };

    // 离线：入队待同步，不发请求（联网后服务端再抓正文）。
    if (isOfflineQueueSupported() && typeof navigator !== 'undefined' && !navigator.onLine) {
      await enqueue('clip', body, temp.id).catch(() => {});
      queueNote(temp.id);
      return;
    }

    try {
      const res = await apiFetch('/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: LONG_TIMEOUT_MS, // 服务端抓取+正文抽取可能较慢
      });
      const result = await res.json();
      if (res.ok && result.note) {
        confirmNote(temp.id, result.note as Note, result.warning);
      } else {
        failNote(temp.id, result.error || '剪藏失败', () =>
          submit(target, whyImportant, knownTitle)
        );
      }
    } catch {
      // 网络错误：落本地队列兜底，不丢这条剪藏。
      if (isOfflineQueueSupported()) {
        await enqueue('clip', body, temp.id).catch(() => {});
        queueNote(temp.id);
      } else {
        failNote(temp.id, '网络错误，剪藏失败', () => submit(target, whyImportant, knownTitle));
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    const target = normalizeUrl(raw);
    const knownTitle = titleRef.current;
    const whyImportant = why.trim() || null;

    // 立即清空，可连续记录
    setUrl('');
    setWhy('');
    setTitle(null);
    void submit(target, whyImportant, knownTitle);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        autoFocus
        type="text"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="粘贴链接，自动抓取标题和正文…"
        className="rounded-card px-4 py-3.5"
      />

      {/* 标题预览：取标题中 / 已取到。无标题或失败时不显示（剪藏端仍会兜底）。 */}
      {(titleLoading || title) && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-field border border-zinc-200/80 bg-zinc-50/60 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40',
            'animate-fade-in'
          )}
        >
          {titleLoading ? (
            <>
              <SpinnerIcon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-zinc-400" />
              <span className="text-zinc-400">正在获取标题…</span>
            </>
          ) : (
            <>
              <LinkIcon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand/70" />
              <span className="min-w-0 flex-1 break-words text-zinc-700 dark:text-zinc-200">
                {title}
              </span>
            </>
          )}
        </div>
      )}

      <Input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="为什么觉得重要？（一句话，可不填）"
        className="px-4 py-2.5 text-sm"
      />
      {/* 移动端 sticky 吸附在底栏上方，键盘弹起 / 滚动时仍可达；桌面端常规流式。 */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-10 -mx-4 bg-gradient-to-t from-zinc-50 via-zinc-50/95 to-transparent px-4 pt-2 pb-1 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-none lg:p-0 dark:from-zinc-950 dark:via-zinc-950/95">
        <Button type="submit" size="lg" fullWidth disabled={!url.trim()}>
          剪藏链接
        </Button>
      </div>
    </form>
  );
}
