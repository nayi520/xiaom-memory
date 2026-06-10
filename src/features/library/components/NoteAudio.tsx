'use client';

/**
 * 记录详情页音频播放：Supabase Storage 签名 URL（RLS 限本人）。
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function NoteAudio({ mediaPath }: { mediaPath: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from('audio')
      .createSignedUrl(mediaPath, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath]);

  if (!url) return <p className="mt-3 text-xs text-zinc-400">音频加载中…</p>;
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls preload="none" src={url} className="mt-3 w-full" />;
}
