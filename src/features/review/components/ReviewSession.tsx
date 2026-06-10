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

const RATING_STYLES: Record<ReviewRating, string> = {
  1: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
  2: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  3: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
  4: 'bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950 dark:text-sky-400 dark:border-sky-900',
};

interface Props {
  items: ReviewQueueItem[];
  totalDue: number;
  digestMd: string | null;
}

export default function ReviewSession({ items, totalDue, digestMd }: Props) {
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
        .catch(() => setSaveErrors((n) => n + 1));

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
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
        <Header />
        <div className="flex flex-1 flex-col gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-center dark:border-zinc-800 dark:bg-zinc-900">
            {items.length === 0 ? (
              <>
                <p className="text-3xl">🎉</p>
                <p className="mt-2 font-semibold">今天没有到期的卡片</p>
                <p className="mt-1 text-sm text-zinc-400">记点新东西，或者休息一下。</p>
              </>
            ) : skipped ? (
              <>
                <p className="text-3xl">🌿</p>
                <p className="mt-2 font-semibold">今天跳过，完全没问题</p>
                <p className="mt-1 text-sm text-zinc-400">
                  卡片会留在队列里，明天再见。
                  {reviewedCount > 0 && `（已完成 ${reviewedCount} 张）`}
                </p>
              </>
            ) : (
              <>
                <p className="text-3xl">✅</p>
                <p className="mt-2 font-semibold">今日复习完成</p>
                <p className="mt-1 text-sm text-zinc-400">
                  共 {reviewedCount} 张
                  {totalDue > items.length && `（还有 ${totalDue - items.length} 张顺延到明天）`}
                </p>
              </>
            )}

            {reviewedCount > 0 && (
              <ul className="mt-4 flex justify-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                {( [1, 2, 3, 4] as ReviewRating[] ).map((r) => (
                  <li key={r}>
                    {RATING_LABELS[r]} {stats[r]}
                  </li>
                ))}
                {graduated > 0 && <li className="text-sky-500">毕业 {graduated} 🎓</li>}
              </ul>
            )}
            {saveErrors > 0 && (
              <p className="mt-2 text-xs text-red-500">
                {saveErrors} 次评分保存失败（网络问题），这些卡片仍会留在队列
              </p>
            )}
          </section>

          {digestMd && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                今日简报
              </h2>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {digestMd}
              </div>
            </section>
          )}

          <Link
            href="/"
            className="mt-2 block rounded-xl bg-brand py-3 text-center font-semibold text-white transition active:opacity-80"
          >
            返回记录
          </Link>
        </div>
      </main>
    );
  }

  // ============ 复习中 ============
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <Header progress={`${idx + 1} / ${items.length}`} />

      <div className="flex flex-1 flex-col">
        <section
          role="button"
          tabIndex={0}
          aria-label={flipped ? '答案' : '问题（点击翻面）'}
          onClick={() => !flipped && setFlipped(true)}
          className={`flex min-h-[40dvh] flex-col rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${
            flipped ? '' : 'cursor-pointer'
          }`}
        >
          {current.conceptName && (
            <p className="mb-2 text-xs text-zinc-400">{current.conceptName}</p>
          )}
          <p className="text-lg font-semibold leading-relaxed">{current.question}</p>

          {flipped ? (
            <div className="mt-4 border-t border-dashed border-zinc-200 pt-4 dark:border-zinc-700">
              <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">
                {current.answer}
              </p>

              {current.notes.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSource((s) => !s);
                    }}
                    className="text-xs text-brand underline-offset-2 transition active:opacity-70"
                  >
                    {showSource ? '收起原始记录 ▴' : '查看原始记录 ▾'}
                  </button>
                  {showSource && (
                    <ul className="mt-2 space-y-2">
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
              点击卡片或按空格翻面
            </p>
          )}
        </section>

        {flipped ? (
          <div className="mt-4 grid grid-cols-4 gap-2">
            {( [1, 2, 3, 4] as ReviewRating[] ).map((r) => (
              <button
                key={r}
                onClick={() => rate(r)}
                className={`rounded-xl border py-3 text-sm font-semibold transition active:opacity-70 ${RATING_STYLES[r]}`}
              >
                {RATING_LABELS[r]}
                <span className="mt-0.5 block text-[10px] font-normal opacity-60">{r}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setFlipped(true)}
            className="mt-4 rounded-xl bg-brand py-3 font-semibold text-white transition active:opacity-80"
          >
            翻面看答案
          </button>
        )}

        <button
          onClick={() => {
            setSkipped(true);
            setFinished(true);
          }}
          className="mt-6 self-center text-xs text-zinc-400 underline-offset-2 transition active:text-zinc-600"
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
      <h1 className="text-xl font-bold text-brand">复习</h1>
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        {progress && <span>{progress}</span>}
        <Link href="/" className="transition active:text-zinc-600">
          ← 返回记录
        </Link>
      </div>
    </header>
  );
}
