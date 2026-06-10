'use client';

/**
 * 首页复习入口：链接到 /review，带今日到期数 badge。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ReviewEntryLink() {
  const [due, setDue] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('cards')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .lte('fsrs_state->>due', new Date().toISOString())
      .then(({ count }) => {
        if (typeof count === 'number') setDue(count);
      });
  }, []);

  return (
    <Link
      href="/review"
      className="relative flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-zinc-500 transition active:text-zinc-700 dark:text-zinc-400"
      aria-label={due ? `复习（${due} 张到期）` : '复习'}
    >
      <span className="text-base leading-none">📖</span>
      <span>复习</span>
      {due !== null && due > 0 && (
        <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </Link>
  );
}
