'use client';

/**
 * 溯源记录（F3.6）：复习卡 → 概念 → 原始记录，展示原文 / 链接 / 音频。
 * 音频走 OSS 签名 URL（经 /api/audio/url，服务端校验归属本人）。
 */

import { useEffect, useState } from 'react';
import type { SourceNote } from '../types';

const TYPE_ICON: Record<string, string> = {
  text: '✏️',
  voice: '🎙️',
  link: '🔗',
  image: '🖼️',
};

export default function NoteSource({ note }: { note: SourceNote }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!note.media_path) return;
    let cancelled = false;
    fetch(`/api/audio/url?key=${encodeURIComponent(note.media_path)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.url) setAudioUrl(data.url as string);
      })
      .catch(() => {
        /* 取地址失败时维持「加载中」占位 */
      });
    return () => {
      cancelled = true;
    };
  }, [note.media_path]);

  const text = note.raw_content || note.transcript || '';

  return (
    <li className="rounded-field border border-zinc-200/80 bg-zinc-50 px-3.5 py-3 text-sm dark:border-zinc-700/80 dark:bg-zinc-800/60">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{TYPE_ICON[note.type] ?? '📝'}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {text && (
            <p className="break-words leading-relaxed text-zinc-700 dark:text-zinc-200">
              {text}
            </p>
          )}
          {note.why_important && (
            <p className="text-xs text-zinc-400">💡 {note.why_important}</p>
          )}
          {note.url && (
            <a
              href={note.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-brand underline underline-offset-2"
            >
              {note.url}
            </a>
          )}
          {note.media_path &&
            (audioUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls preload="none" src={audioUrl} className="w-full" />
            ) : (
              <p className="text-xs text-zinc-400">音频加载中…</p>
            ))}
          <p className="text-xs text-zinc-400">
            记录于 {new Date(note.created_at).toLocaleDateString('zh-CN')}
          </p>
        </div>
      </div>
    </li>
  );
}
