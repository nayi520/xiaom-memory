'use client';

/**
 * 记录里的图片展示（V13 图片捕获）：OSS 签名 URL（经 /api/images/url，服务端校验归属本人）。
 * 懒加载 + 占位防抖：未取到 URL 时显示加载占位；图未到时浅底占位、到达后平滑淡入，避免布局抖动（CLS）。
 */

import { useEffect, useState } from 'react';
import { cn } from '@/components/ui';
import { apiFetch } from '@/lib/api';

export default function NoteImage({
  mediaPath,
  alt = '图片记录',
  className,
}: {
  mediaPath: string;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    // 签名 URL 探测：401 不弹重登浮层（页面其它主请求会处理），仅显示图片占位。
    apiFetch(`/api/images/url?key=${encodeURIComponent(mediaPath)}`, { notifyOn401: false })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.url) setUrl(data.url as string);
        else setFailed(true);
      })
      .catch(() => {
        // 取地址失败时显示占位，不打断页面。
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath]);

  if (failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-field border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900',
          className
        )}
      >
        图片加载失败
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-field border border-zinc-200/70 bg-zinc-100 px-4 py-6 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800/60',
          className
        )}
      >
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-brand" />
        图片加载中…
      </div>
    );
  }

  const reveal = (el: HTMLImageElement) => {
    el.style.opacity = '1';
    el.style.minHeight = '0';
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn(
        'h-auto max-w-full rounded-field border border-zinc-200/70 bg-zinc-100 object-contain opacity-0 transition-opacity duration-300 [min-height:6rem] dark:border-zinc-800 dark:bg-zinc-800/60',
        className
      )}
      // 兜底缓存命中：若图片在 onLoad 绑定前已 complete，挂载时直接显现，避免一直透明。
      ref={(el) => {
        if (el && el.complete && el.naturalWidth > 0) reveal(el);
      }}
      onLoad={(e) => reveal(e.currentTarget)}
      onError={() => setFailed(true)}
    />
  );
}
