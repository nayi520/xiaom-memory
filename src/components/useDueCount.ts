'use client';

/**
 * 「今日到期」复习数 —— 侧栏 / 底栏共用的小钩子。
 * 路由变化时重新拉取（复习后回到其它页角标即时更新）；登录/鉴权页或网络错误时回退 0，不打扰。
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export function useDueCount(): number {
  const pathname = usePathname();
  const hidden = pathname.startsWith('/login') || pathname.startsWith('/auth');
  const [due, setDue] = useState(0);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    // 后台角标轮询：401 不触发重登浮层（避免会话刷新瞬间误报），仅静默回退。
    apiFetch('/api/review/due', { notifyOn401: false })
      .then((res) => (res.ok ? res.json() : { due: 0 }))
      .then((data: { due?: number }) => {
        if (!cancelled && typeof data.due === 'number') setDue(data.due);
      })
      .catch(() => {
        /* 网络错误：角标维持当前值，不打扰 */
      });
    return () => {
      cancelled = true;
    };
  }, [hidden, pathname]);

  return hidden ? 0 : due;
}
