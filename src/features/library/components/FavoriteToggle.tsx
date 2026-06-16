'use client';

/**
 * 概念「收藏」开关（V15）。POST /api/library/favorite { conceptId, favorite }。
 * 收藏存于 profiles.settings.favoriteConcepts（无迁移）；知识库可筛「收藏」并置顶。
 * 乐观更新：点击即翻转本地状态，失败回滚 + toast。
 */

import { useState } from 'react';
import { Button, useToast } from '@/components/ui';

export default function FavoriteToggle({
  conceptId,
  initial,
}: {
  conceptId: string;
  initial: boolean;
}) {
  const { error: toastError } = useToast();
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !fav;
    setFav(next); // 乐观更新
    setBusy(true);
    try {
      const res = await fetch('/api/library/favorite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conceptId, favorite: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFav(!next); // 回滚
        toastError(data.error ?? `操作失败（${res.status}）`);
      }
    } catch (err) {
      setFav(!next);
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={fav ? 'primary' : 'secondary'}
      size="sm"
      onClick={toggle}
      loading={busy}
      aria-pressed={fav}
      title={fav ? '取消收藏' : '收藏'}
    >
      <StarIcon filled={fav} />
      {fav ? '已收藏' : '收藏'}
    </Button>
  );
}

/** 五角星图标（实心 = 已收藏）。内联避免给 ui 图标库新增依赖。 */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
