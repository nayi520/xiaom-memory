'use client';

/**
 * 记录详情页音频播放：OSS 签名 URL（经 /api/audio/url，服务端校验归属本人）。
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function NoteAudio({ mediaPath }: { mediaPath: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 签名 URL 探测：401 不弹重登浮层（页面主请求会处理），仅维持加载占位。
    apiFetch(`/api/audio/url?key=${encodeURIComponent(mediaPath)}`, { notifyOn401: false })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.url) setUrl(data.url as string);
      })
      .catch(() => {
        /* 取地址失败时维持「加载中」占位，不打断页面 */
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath]);

  if (!url)
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-brand" />
        音频加载中…
      </p>
    );
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls preload="none" src={url} className="mt-3 w-full" />;
}
