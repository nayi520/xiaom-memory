'use client';

/**
 * 复习会话（F3.3 / F3.4 / F3.6）
 * 问题 → 点击/空格翻面 → 答案 + 四档自评（键盘 1-4）→ 自动下一张
 * 答案面可展开"查看原始记录"溯源；完成页展示今日简报与统计；
 * "全部跳过今天"无罪化退出（PRD 风险对策）。
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RATING_LABELS, type ReviewRating } from '../fsrs';
import type { ReviewQueueItem } from '../types';
import NoteSource from './NoteSource';
import {
  Button,
  SectionTitle,
  CelebrateIcon,
  RestIcon,
  SuccessIcon,
  GraduateIcon,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  useToast,
  cn,
} from '@/components/ui';
import type { LucideIcon } from '@/components/ui';

const RATING_STYLES: Record<ReviewRating, string> = {
  1: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-900/60',
  2: 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900 dark:hover:bg-amber-900/60',
  3: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900 dark:hover:bg-emerald-900/60',
  4: 'bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-400 dark:border-sky-900 dark:hover:bg-sky-900/60',
};

interface Props {
  items: ReviewQueueItem[];
  totalDue: number;
  digestMd: string | null;
}

export default function ReviewSession({ items, totalDue, digestMd }: Props) {
  const { error: toastError } = useToast();
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [stats, setStats] = useState<Record<ReviewRating, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [graduated, setGraduated] = useState(0);
  const [saveErrors, setSaveErrors] = useState(0);
  const [finished, setFinished] = useState(items.length === 0);
  const [skipped, setSkipped] = useState(false);

  const current = items[idx];

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!current) return;
      setStats((s) => ({ ...s, [rating]: s[rating] + 1 }));
      setFlipped(false);
      setShowSource(false);

      // 异步落库（写 reviews + 更新 fsrs_state），不阻塞翻下一张
      fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardId: current.id, rating }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { graduated?: boolean };
          if (data.graduated) setGraduated((g) => g + 1);
        })
        .catch(() => {
          // 仅在第一次失败时弹一次 toast（避免连续失败刷屏）；完成页另有累计提示。
          setSaveErrors((n) => {
            if (n === 0) toastError('评分没保存上（网络问题），这张卡片会留在队列');
            return n + 1;
          });
        });

      if (idx + 1 >= items.length) {
        setFinished(true);
      } else {
        setIdx(idx + 1);
      }
    },
    [current, idx, items.length]
  );

  // 键盘：空格/回车翻面，1-4 评分
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (finished) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as ReviewRating);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, flipped, rate]);

  // ============ 完成页 ============
  if (finished) {
    const reviewedCount = stats[1] + stats[2] + stats[3] + stats[4];
    const { Icon: HeroIcon, color: heroColor } = ((): {
      Icon: LucideIcon;
      color: string;
    } => {
      if (items.length === 0) return { Icon: CelebrateIcon, color: 'text-brand' };
      if (skipped) return { Icon: RestIcon, color: 'text-emerald-500' };
      return { Icon: SuccessIcon, color: 'text-emerald-500' };
    })();
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
        <Header />
        <div className="flex flex-1 flex-col gap-4">
          <section className="animate-fade-in-up rounded-card border border-zinc-200/80 bg-white p-7 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto mb-1 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-zinc-100 to-zinc-50 shadow-card ring-1 ring-zinc-200/60 dark:from-zinc-800 dark:to-zinc-900 dark:ring-zinc-700/60">
              <HeroIcon aria-hidden className={cn('h-8 w-8', heroColor)} />
            </div>
            {items.length === 0 ? (
              <>
                <p className="mt-3 text-lg font-semibold">今天没有到期的卡片</p>
                <p className="mt-1 text-sm text-zinc-400">记点新东西，或者休息一下。</p>
              </>
            ) : skipped ? (
              <>
                <p className="mt-3 text-lg font-semibold">今天跳过，完全没问题</p>
                <p className="mt-1 text-sm text-zinc-400">
                  卡片会留在队列里，明天再见。
                  {reviewedCount > 0 && `（已完成 ${reviewedCount} 张）`}
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-lg font-semibold">今日复习完成</p>
                <p className="mt-1 text-sm text-zinc-400">
                  共 {reviewedCount} 张
                  {totalDue > items.length && `（还有 ${totalDue - items.length} 张顺延到明天）`}
                </p>
              </>
            )}

            {reviewedCount > 0 && (
              <ul className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
                {( [1, 2, 3, 4] as ReviewRating[] ).map((r) => (
                  <li
                    key={r}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 font-medium',
                      RATING_STYLES[r]
                    )}
                  >
                    {RATING_LABELS[r]} {stats[r]}
                  </li>
                ))}
                {graduated > 0 && (
                  <li className="inline-flex items-center gap-1 rounded-pill border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-600 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-400">
                    <GraduateIcon aria-hidden className="h-3.5 w-3.5" />
                    毕业 {graduated}
                  </li>
                )}
              </ul>
            )}
            {saveErrors > 0 && (
              <p className="mt-3 text-xs text-red-500">
                {saveErrors} 次评分保存失败（网络问题），这些卡片仍会留在队列
              </p>
            )}
          </section>

          {digestMd && (
            <section className="animate-fade-in-up rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
              <SectionTitle>今日简报</SectionTitle>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {digestMd}
              </div>
            </section>
          )}

          <Link
            href="/"
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-field bg-brand py-3 text-center font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-brand-dark hover:shadow-card-hover active:scale-[0.99]"
          >
            返回记录
          </Link>
        </div>
      </main>
    );
  }

  // ============ 复习中 ============
  const progressPct = Math.round((idx / items.length) * 100);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      <Header progress={`${idx + 1} / ${items.length}`} />

      {/* 进度条 */}
      <div
        className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={idx + 1}
        aria-valuemin={1}
        aria-valuemax={items.length}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-dark transition-all duration-300 ease-smooth"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col">
        <section
          role="button"
          tabIndex={0}
          aria-label={flipped ? '答案' : '问题（点击翻面）'}
          onClick={() => !flipped && setFlipped(true)}
          onKeyDown={(e) => {
            if (!flipped && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setFlipped(true);
            }
          }}
          className={cn(
            'flex min-h-[40dvh] flex-col rounded-card border border-zinc-200/80 bg-white p-6 shadow-card transition duration-200 dark:border-zinc-800 dark:bg-zinc-900',
            flipped ? '' : 'cursor-pointer hover:border-zinc-300 hover:shadow-card-hover dark:hover:border-zinc-700'
          )}
        >
          {current.conceptName && (
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-brand/70">
              {current.conceptName}
            </p>
          )}
          <p className="text-lg font-semibold leading-relaxed text-zinc-900 dark:text-zinc-50">
            {current.question}
          </p>

          {flipped ? (
            <div className="animate-flip-in mt-5 border-t border-dashed border-zinc-200 pt-5 dark:border-zinc-700">
              <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">
                {current.answer}
              </p>

              {current.notes.length > 0 && (
                <div className="mt-5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSource((s) => !s);
                    }}
                    className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-brand underline-offset-2 transition hover:underline focus-visible:outline-none"
                  >
                    {showSource ? '收起原始记录' : '查看原始记录'}
                    {showSource ? (
                      <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {showSource && (
                    <ul className="animate-fade-in mt-2.5 space-y-2">
                      {current.notes.map((note) => (
                        <NoteSource key={note.id} note={note} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-auto pt-6 text-center text-xs text-zinc-400">
              点击卡片或按 <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">空格</kbd> 翻面
            </p>
          )}
        </section>

        {flipped ? (
          <div className="animate-fade-in-up mt-4 grid grid-cols-4 gap-2">
            {( [1, 2, 3, 4] as ReviewRating[] ).map((r) => (
              <button
                key={r}
                onClick={() => rate(r)}
                className={cn(
                  'rounded-field border py-3 text-sm font-semibold transition duration-150 ease-smooth active:scale-95',
                  RATING_STYLES[r]
                )}
              >
                {RATING_LABELS[r]}
                <span className="mt-0.5 block text-[10px] font-normal opacity-60">{r}</span>
              </button>
            ))}
          </div>
        ) : (
          <Button size="lg" fullWidth className="mt-4" onClick={() => setFlipped(true)}>
            翻面看答案
          </Button>
        )}

        <button
          onClick={() => {
            setSkipped(true);
            setFinished(true);
          }}
          className="mt-6 self-center rounded-md text-xs text-zinc-400 underline-offset-2 transition hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
        >
          全部跳过今天（不计错，明天再来）
        </button>
      </div>
    </main>
  );
}

function Header({ progress }: { progress?: string }) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">复习</h1>
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        {progress && (
          <span className="rounded-pill bg-zinc-100 px-2.5 py-1 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {progress}
          </span>
        )}
        <Link
          href="/"
          className="inline-flex items-center gap-0.5 rounded-md transition hover:text-zinc-600 focus-visible:outline-none dark:hover:text-zinc-300"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
          返回
        </Link>
      </div>
    </header>
  );
}
