'use client';

/**
 * 复习会话（F3.3 / F3.4 / F3.6 + V7 复习体验深化）
 *
 * 复习中：问题 → 点击/空格翻面 → 答案 + 四档自评（键盘 1-4）→ 自动下一张。
 *   - 进度条（本次第 n / 共 m 张）+ 连击（连续 记得/轻松 计数）+ 今日目标进度。
 *   - 桌面端标注键盘快捷键提示（空格翻面、1-4 评分）。
 *   - 答案面可展开「查看原始记录」溯源，并可就地编辑卡片 Q/A、暂停（埋葬）卡片。
 * 完成页：本次张数、正确率（rating≥3 占比）、下次到期时间、四档分布；「回首页 / 继续复习」。
 *   - 「全部跳过今天」无罪化退出（PRD 风险对策）。
 *
 * 卡片管理走 PATCH /api/cards/{id}（编辑 question/answer，或 status='suspended' 暂停）。
 * 评分走 POST /api/review，读返回的 nextDueAt（下次到期）与 graduated（毕业）。
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RATING_LABELS, type ReviewRating } from '../fsrs';
import type { ReviewQueueItem } from '../types';
import NoteSource from './NoteSource';
import {
  Button,
  Textarea,
  SectionTitle,
  CelebrateIcon,
  RestIcon,
  SuccessIcon,
  GraduateIcon,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  EditIcon,
  SuspendIcon,
  ComboIcon,
  GoalIcon,
  DueIcon,
  HomeIcon,
  ReviewIcon,
  SaveIcon,
  CloseIcon,
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
  /** 进入本次会话前，今天已复习的张数（目标进度的起点）。 */
  reviewedToday: number;
  /** 每日复习目标（张）。 */
  dailyGoal: number;
}

/** 把下次到期 ISO 格式化成「相对人话」：今天/明天/N 天后/具体日期。 */
function formatNextDue(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '明天';
  if (days < 30) return `${days} 天后`;
  return due.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ReviewSession({
  items,
  totalDue,
  digestMd,
  reviewedToday,
  dailyGoal,
}: Props) {
  const { error: toastError, success } = useToast();
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [stats, setStats] = useState<Record<ReviewRating, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [graduated, setGraduated] = useState(0);
  const [saveErrors, setSaveErrors] = useState(0);
  const [finished, setFinished] = useState(items.length === 0);
  const [skipped, setSkipped] = useState(false);
  // 连击：连续「记得/轻松」（rating≥3）计数，断于「忘了/模糊」。
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  // 下次到期：取最近一次评分返回的 nextDueAt（完成页展示）。
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  // 卡片就地编辑：cardId → 覆盖后的 {question, answer}（评分/暂停不依赖它，仅改展示）。
  const [edits, setEdits] = useState<Record<string, { question: string; answer: string }>>({});
  // 本次会话暂停的卡片张数（仅用于完成页提示，暂停后线性流不再回到该卡）。
  const [suspendedCount, setSuspendedCount] = useState(0);

  // 编辑态（每次进入复制当前 Q/A 到草稿）。
  const [editing, setEditing] = useState(false);
  const [draftQ, setDraftQ] = useState('');
  const [draftA, setDraftA] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const baseCurrent = items[idx];
  // 当前卡（叠加就地编辑覆盖）。
  const current = useMemo(() => {
    if (!baseCurrent) return baseCurrent;
    const e = edits[baseCurrent.id];
    return e ? { ...baseCurrent, question: e.question, answer: e.answer } : baseCurrent;
  }, [baseCurrent, edits]);

  const reviewedCount = stats[1] + stats[2] + stats[3] + stats[4];
  // 今日目标进度 = 进入前已复习 + 本次会话已复习。
  const goalDone = reviewedToday + reviewedCount;
  const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((goalDone / dailyGoal) * 100)) : 0;

  /** 关闭编辑态并清草稿。 */
  const closeEdit = useCallback(() => {
    setEditing(false);
    setSavingEdit(false);
  }, []);

  /** 推进到下一张（或结束）。复用于评分后与暂停后。 */
  const advance = useCallback(() => {
    setFlipped(false);
    setShowSource(false);
    closeEdit();
    setIdx((i) => {
      const next = i + 1;
      if (next >= items.length) {
        setFinished(true);
        return i;
      }
      return next;
    });
  }, [items.length, closeEdit]);

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!current || editing) return;
      setStats((s) => ({ ...s, [rating]: s[rating] + 1 }));
      // 连击：≥3 续；否则断。
      if (rating >= 3) {
        setCombo((c) => {
          const n = c + 1;
          setMaxCombo((m) => Math.max(m, n));
          return n;
        });
      } else {
        setCombo(0);
      }

      // 异步落库（写 reviews + 更新 fsrs_state），不阻塞翻下一张。
      fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardId: current.id, rating }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { graduated?: boolean; nextDueAt?: string };
          if (data.graduated) setGraduated((g) => g + 1);
          if (data.nextDueAt) setNextDueAt(data.nextDueAt);
        })
        .catch(() => {
          // 仅在第一次失败时弹一次 toast（避免连续失败刷屏）；完成页另有累计提示。
          setSaveErrors((n) => {
            if (n === 0) toastError('评分没保存上（网络问题），这张卡片会留在队列');
            return n + 1;
          });
        });

      advance();
    },
    [current, editing, advance, toastError]
  );

  /** 保存卡片编辑（PATCH /api/cards/{id}）。成功后就地覆盖展示。 */
  const saveEdit = useCallback(async () => {
    if (!current) return;
    const q = draftQ.trim();
    const a = draftA.trim();
    if (!q || !a) {
      toastError('问题和答案都不能为空');
      return;
    }
    if (q === current.question && a === current.answer) {
      closeEdit();
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/cards/${current.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, answer: a }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      setEdits((prev) => ({ ...prev, [current.id]: { question: q, answer: a } }));
      success('卡片已更新');
      closeEdit();
    } catch (err) {
      setSavingEdit(false);
      toastError(err instanceof Error ? err.message : '保存失败');
    }
  }, [current, draftQ, draftA, success, toastError, closeEdit]);

  /** 暂停（埋葬）当前卡：PATCH status='suspended'，不计入本次复习，直接跳下一张。 */
  const suspendCard = useCallback(async () => {
    if (!current || suspending) return;
    setSuspending(true);
    const id = current.id;
    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `操作失败（${res.status}）`);
      }
      setSuspendedCount((n) => n + 1);
      success('已暂停这张卡片，不再进入复习队列');
      setSuspending(false);
      advance();
    } catch (err) {
      setSuspending(false);
      toastError(err instanceof Error ? err.message : '操作失败');
    }
  }, [current, suspending, advance, success, toastError]);

  // 键盘：空格/回车翻面，1-4 评分（编辑态下让位给输入框，不拦截）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (finished || editing) return;
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
  }, [finished, editing, flipped, rate]);

  // ============ 完成页 ============
  if (finished) {
    const accuracy =
      reviewedCount > 0 ? Math.round(((stats[3] + stats[4]) / reviewedCount) * 100) : 0;
    const dueLabel = formatNextDue(nextDueAt);
    const remaining = totalDue - items.length;
    const { Icon: HeroIcon, color: heroColor } = ((): {
      Icon: LucideIcon;
      color: string;
    } => {
      if (items.length === 0) return { Icon: CelebrateIcon, color: 'text-brand' };
      if (skipped) return { Icon: RestIcon, color: 'text-emerald-500' };
      return { Icon: SuccessIcon, color: 'text-emerald-500' };
    })();

    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10 lg:max-w-reading lg:px-10 lg:pb-12 lg:pt-12">
        <Header />
        <div className="flex flex-1 flex-col gap-4">
          <section className="animate-fade-in-up rounded-card border border-zinc-200/80 bg-white p-7 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto mb-1 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-zinc-100 to-zinc-50 shadow-card ring-1 ring-zinc-200/60 dark:from-zinc-800 dark:to-zinc-900 dark:ring-zinc-700/60">
              <HeroIcon aria-hidden className={cn('h-8 w-8', heroColor)} />
            </div>
            {items.length === 0 ? (
              <>
                <p className="mt-3 text-lg font-semibold">今天没有到期的卡片</p>
                <p className="mt-1 text-sm text-zinc-400">
                  小M 会把你记录的内容整理成复习卡片，按记忆曲线在该复习时提醒你。先去记点东西吧。
                </p>
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
                  {remaining > 0 && `（还有 ${remaining} 张顺延到明天）`}
                </p>
              </>
            )}

            {/* 本次核心指标：张数 / 正确率 / 下次到期 */}
            {reviewedCount > 0 && (
              <div className="mt-6 grid grid-cols-3 gap-2.5">
                <SummaryStat label="本次复习" value={`${reviewedCount}`} unit="张" />
                <SummaryStat
                  label="正确率"
                  value={`${accuracy}`}
                  unit="%"
                  hint="记得/轻松占比"
                />
                <SummaryStat
                  label="下次到期"
                  value={dueLabel ?? '—'}
                  icon={<DueIcon aria-hidden className="h-3.5 w-3.5" />}
                />
              </div>
            )}

            {reviewedCount > 0 && (
              <ul className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
                {([1, 2, 3, 4] as ReviewRating[]).map((r) => (
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
                {maxCombo >= 2 && (
                  <li className="inline-flex items-center gap-1 rounded-pill border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-600 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                    <ComboIcon aria-hidden className="h-3.5 w-3.5" />
                    最高连击 {maxCombo}
                  </li>
                )}
                {graduated > 0 && (
                  <li className="inline-flex items-center gap-1 rounded-pill border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-600 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-400">
                    <GraduateIcon aria-hidden className="h-3.5 w-3.5" />
                    毕业 {graduated}
                  </li>
                )}
                {suspendedCount > 0 && (
                  <li className="inline-flex items-center gap-1 rounded-pill border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                    <SuspendIcon aria-hidden className="h-3.5 w-3.5" />
                    暂停 {suspendedCount}
                  </li>
                )}
              </ul>
            )}

            {/* 今日目标进度 */}
            <div className="mt-6">
              <GoalProgress done={goalDone} goal={dailyGoal} pct={goalPct} />
            </div>

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

          {/* 操作：继续复习（还有顺延卡时）/ 回首页 */}
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {!skipped && remaining > 0 ? (
              <Link
                href="/review"
                prefetch={false}
                className="inline-flex w-full items-center justify-center gap-2 rounded-field bg-brand py-3 text-center font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-brand-dark hover:shadow-card-hover active:scale-[0.99]"
              >
                <ReviewIcon aria-hidden className="h-4 w-4" />
                继续复习
              </Link>
            ) : null}
            <Link
              href="/"
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-field py-3 text-center font-semibold transition duration-150 ease-smooth active:scale-[0.99]',
                !skipped && remaining > 0
                  ? 'border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
                  : 'bg-brand text-white shadow-card hover:bg-brand-dark hover:shadow-card-hover'
              )}
            >
              <HomeIcon aria-hidden className="h-4 w-4" />
              回首页
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ============ 复习中 ============
  const progressPct = Math.round((idx / items.length) * 100);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col px-4 pb-28 pt-6 sm:px-6 sm:pt-10 lg:max-w-reading lg:px-10 lg:pb-12 lg:pt-12">
      <Header progress={`${idx + 1} / ${items.length}`} combo={combo} />

      {/* 进度条 */}
      <div
        className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={idx + 1}
        aria-valuemin={1}
        aria-valuemax={items.length}
        aria-label="复习进度"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-dark transition-all duration-300 ease-smooth"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* 今日目标进度（紧凑行） */}
      <GoalProgress done={goalDone} goal={dailyGoal} pct={goalPct} compact />

      <div className="mt-4 flex flex-1 flex-col">
        <section
          role={editing ? undefined : 'button'}
          tabIndex={editing ? undefined : 0}
          aria-label={editing ? undefined : flipped ? '答案' : '问题（点击翻面）'}
          onClick={() => !flipped && !editing && setFlipped(true)}
          onKeyDown={(e) => {
            if (!editing && !flipped && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setFlipped(true);
            }
          }}
          className={cn(
            'flex min-h-[40dvh] flex-col rounded-card border border-zinc-200/80 bg-white p-6 shadow-card transition duration-200 dark:border-zinc-800 dark:bg-zinc-900',
            !flipped && !editing
              ? 'cursor-pointer hover:border-zinc-300 hover:shadow-card-hover dark:hover:border-zinc-700'
              : ''
          )}
        >
          {editing ? (
            /* —— 编辑态：改 Q/A —— */
            <div className="flex flex-1 flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-brand/70">
                编辑卡片
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  问题
                </span>
                <Textarea
                  value={draftQ}
                  onChange={(e) => setDraftQ(e.target.value)}
                  rows={2}
                  disabled={savingEdit}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  答案
                </span>
                <Textarea
                  value={draftA}
                  onChange={(e) => setDraftA(e.target.value)}
                  rows={4}
                  disabled={savingEdit}
                />
              </label>
              <div className="mt-auto flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeEdit}
                  disabled={savingEdit}
                >
                  <CloseIcon aria-hidden className="h-3.5 w-3.5" />
                  取消
                </Button>
                <Button size="sm" onClick={saveEdit} loading={savingEdit}>
                  {!savingEdit && <SaveIcon aria-hidden className="h-3.5 w-3.5" />}
                  保存
                </Button>
              </div>
            </div>
          ) : (
            /* —— 展示态：问题 / 翻面后答案 + 溯源 + 卡片操作 —— */
            <>
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
                  <p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-200">
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

                  {/* 卡片管理：编辑 Q/A、暂停（埋葬） */}
                  <div className="mt-5 flex items-center gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraftQ(current.question);
                        setDraftA(current.answer);
                        setEditing(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-zinc-500 transition hover:text-brand focus-visible:outline-none dark:text-zinc-400"
                    >
                      <EditIcon aria-hidden className="h-3.5 w-3.5" />
                      编辑卡片
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        suspendCard();
                      }}
                      disabled={suspending}
                      className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-zinc-500 transition hover:text-red-500 focus-visible:outline-none disabled:opacity-50 dark:text-zinc-400"
                    >
                      <SuspendIcon aria-hidden className="h-3.5 w-3.5" />
                      暂停卡片
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-auto pt-6 text-center text-xs text-zinc-400">
                  点击卡片或按{' '}
                  <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">空格</kbd>{' '}
                  翻面
                </p>
              )}
            </>
          )}
        </section>

        {/* 评分区（编辑态隐藏） */}
        {!editing && (flipped ? (
          <div className="animate-fade-in-up mt-4 grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as ReviewRating[]).map((r) => (
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
        ))}

        {/* 桌面端键盘快捷键提示（移动端隐藏） */}
        {!editing && (
          <div className="mt-3 hidden items-center justify-center gap-3 text-[11px] text-zinc-400 lg:flex">
            <Shortcut keys={['空格']} label="翻面" />
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Shortcut keys={['1']} label="忘了" />
            <Shortcut keys={['2']} label="模糊" />
            <Shortcut keys={['3']} label="记得" />
            <Shortcut keys={['4']} label="轻松" />
          </div>
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

/** 完成页核心指标小卡。 */
function SummaryStat({
  label,
  value,
  unit,
  hint,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-field border border-zinc-200/80 bg-zinc-50/60 px-2 py-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <div className="flex items-baseline justify-center gap-0.5">
        <span className="text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
          {value}
        </span>
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-zinc-400">
        {icon}
        {label}
      </div>
      {hint && <div className="mt-px text-center text-[10px] text-zinc-300 dark:text-zinc-600">{hint}</div>}
    </div>
  );
}

/** 今日目标进度条（compact 用于复习中的紧凑行，否则用于完成页）。 */
function GoalProgress({
  done,
  goal,
  pct,
  compact,
}: {
  done: number;
  goal: number;
  pct: number;
  compact?: boolean;
}) {
  const reached = done >= goal;
  return (
    <div className={cn(compact ? '' : 'text-left')}>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <GoalIcon aria-hidden className="h-3 w-3" />
          今日目标
        </span>
        <span className="tabular-nums">
          {done} / {goal}
          {reached && ' · 已达成 🎉'}
        </span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={Math.min(done, goal)}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label="今日复习目标进度"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-smooth',
            reached
              ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
              : 'bg-gradient-to-r from-amber-300 to-amber-400'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** 单个键盘快捷键提示（键帽 + 说明）。 */
function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

function Header({
  progress,
  combo,
}: {
  progress?: string;
  combo?: number;
}) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">复习</h1>
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        {combo !== undefined && combo >= 2 && (
          <span className="inline-flex items-center gap-1 rounded-pill border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-amber-600 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            <ComboIcon aria-hidden className="h-3.5 w-3.5" />
            连击 {combo}
          </span>
        )}
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
