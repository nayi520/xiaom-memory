'use client';

/**
 * 知识体检报告（V17）—— 独立拉取 /api/checkup（已鉴权 + userId 过滤）。
 *   - gaps：覆盖盲区（有概念无卡片的领域 / 待整理积压）。
 *   - stale：久未复习的概念（点击进概念详情）。
 *   - suggestions：可操作建议清单。
 * 加载中骨架；失败友好降级（整块隐藏，不打扰）。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  SectionTitle,
  WarningIcon,
  ClockIcon,
  ChevronRight,
  cn,
} from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

interface Gap {
  domain: string;
  reason: string;
}
interface StaleConcept {
  conceptId: string;
  name: string;
  lastReviewed?: string;
}
interface Checkup {
  gaps: Gap[];
  stale: StaleConcept[];
  suggestions: string[];
}

export default function CheckupReport({ className }: { className?: string }) {
  const [data, setData] = useState<Checkup | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/checkup', { timeoutMs: LONG_TIMEOUT_MS })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('checkup');
        return json as Checkup;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;

  const loading = data === null;

  return (
    <section className={cn('space-y-3', className)}>
      <SectionTitle className="mb-1">知识体检</SectionTitle>

      {loading ? (
        <div className="h-28 animate-pulse rounded-card bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <div className="space-y-3">
          {/* 建议（总在最前，给方向） */}
          {data.suggestions.length > 0 && (
            <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                体检建议
              </p>
              <ul className="space-y-1.5">
                {data.suggestions.map((s, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 覆盖盲区 */}
          {data.gaps.length > 0 && (
            <div className="rounded-card border border-amber-200/70 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-1.5">
                <WarningIcon aria-hidden className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  覆盖盲区
                </p>
              </div>
              <ul className="space-y-1.5">
                {data.gaps.map((g, i) => (
                  <li key={`${g.domain}-${i}`} className="text-sm">
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {g.domain}
                    </span>
                    <span className="text-zinc-400"> · {g.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 久未复习的概念 */}
          {data.stale.length > 0 && (
            <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 flex items-center gap-1.5">
                <ClockIcon aria-hidden className="h-3.5 w-3.5 text-zinc-400" />
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  久未复习
                </p>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.stale.map((c) => (
                  <li key={c.conceptId}>
                    <Link
                      href={`/library/concept/${c.conceptId}`}
                      className="group flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-zinc-700 group-hover:text-brand dark:text-zinc-200">
                        {c.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400">
                        {c.lastReviewed ? `上次 ${fromNow(c.lastReviewed)}` : '从未复习'}
                        <ChevronRight
                          aria-hidden
                          className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 全空（理论上 suggestions 必有一条正向反馈，这里兜底） */}
          {data.gaps.length === 0 &&
            data.stale.length === 0 &&
            data.suggestions.length === 0 && (
              <p className="rounded-card border border-dashed border-zinc-200 px-4 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                暂无体检结果，继续记录与复习吧。
              </p>
            )}
        </div>
      )}
    </section>
  );
}

/** ISO 时间 → 「N 天前 / 今天 / N 周前」粗粒度相对描述。 */
function fromNow(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
