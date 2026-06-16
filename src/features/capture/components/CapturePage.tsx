'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Note } from '@/lib/types';
import type { CaptureTab, RecentItem } from '../types';
import TextCapture from './TextCapture';
import VoiceCapture from './VoiceCapture';
import LinkCapture from './LinkCapture';
import RecentNotes from './RecentNotes';
import DashboardPanel from './DashboardPanel';
import { OUTBOX_SYNCED_EVENT } from '@/features/offline/OfflineProvider';
import { PageShell, TextIcon, VoiceIcon, LinkIcon, AiIcon, useToast, cn } from '@/components/ui';
import type { LucideIcon } from '@/components/ui';

const TABS: { key: CaptureTab; label: string; Icon: LucideIcon }[] = [
  { key: 'text', label: '文本', Icon: TextIcon },
  { key: 'voice', label: '语音', Icon: VoiceIcon },
  { key: 'link', label: '链接', Icon: LinkIcon },
];

export default function CapturePage() {
  const [tab, setTab] = useState<CaptureTab>('text');
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const { error: toastError, info: toastInfo } = useToast();

  // 加载最近 3 条（保留本地仍待同步的离线占位，避免被服务端列表覆盖丢失）。
  const refreshRecent = useCallback(() => {
    let cancelled = false;
    fetch('/api/notes?limit=3')
      .then((res) => (res.ok ? res.json() : { notes: [] }))
      .then((data: { notes?: Note[] }) => {
        if (cancelled || !data.notes) return;
        setRecent((prev) => {
          const queued = prev.filter((n) => n.queued || n.pending);
          const server = (data.notes as RecentItem[]).filter(
            (s) => !queued.some((q) => q.id === s.id)
          );
          return [...queued, ...server].slice(0, 3);
        });
      })
      .catch(() => {
        /* 网络错误：最近列表留空（离线占位仍在） */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshRecent(), [refreshRecent]);

  // 离线队列同步完成 → 刷新最近列表（把「待同步」占位换成已落库记录）。
  useEffect(() => {
    const onSynced = () => refreshRecent();
    window.addEventListener(OUTBOX_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OUTBOX_SYNCED_EVENT, onSynced);
  }, [refreshRecent]);

  /** 乐观插入一条（提交瞬间调用） */
  const addOptimistic = useCallback((item: RecentItem) => {
    setRecent((prev) => [item, ...prev].slice(0, 3));
  }, []);

  /** 服务端确认后用真实数据替换，并弹「已记下，AI 正在整理」即时反馈。 */
  const confirmNote = useCallback(
    (tempId: string, note: Note, hint?: string) => {
      setRecent((prev) =>
        prev.map((n) =>
          n.id === tempId ? ({ ...note, pending: false, hint } as RecentItem) : n
        )
      );
      // 落库成功 → AI 异步整理，给用户即时确认（避免"提交后无声"）。
      toastInfo('已记下，小M 正在整理…');
    },
    [toastInfo]
  );

  /** 更新某条（如转写完成） */
  const updateNote = useCallback((id: string, patch: Partial<RecentItem>) => {
    setRecent((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  /**
   * 提交失败标记：列表内保留红色「失败」徽标作持久态，同时弹 toast 即时告知。
   * retry 由录入组件传入（重发同一请求），挂到该条上供「重试」按钮调用。
   */
  const failNote = useCallback(
    (tempId: string, message?: string, retry?: () => void) => {
      setRecent((prev) =>
        prev.map((n) =>
          n.id === tempId
            ? { ...n, pending: false, failed: true, hint: message, retry }
            : n
        )
      );
      toastError(message || '保存失败，请重试');
    },
    [toastError]
  );

  /**
   * 离线入队标记：该条已写入本地队列、待联网同步。保留为占位（queued），
   * 联网后由 OfflineProvider 自动同步并刷新列表替换为真实记录。
   */
  const queueNote = useCallback(
    (tempId: string) => {
      setRecent((prev) =>
        prev.map((n) =>
          n.id === tempId
            ? { ...n, pending: false, failed: false, queued: true, retry: undefined }
            : n
        )
      );
      toastInfo('当前离线，已存入本地，联网后自动同步');
    },
    [toastInfo]
  );

  /** 软删后从最近列表乐观移除（F5） */
  const removeNote = useCallback((id: string) => {
    setRecent((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handlers = { addOptimistic, confirmNote, updateNote, failNote, queueNote };

  return (
    <PageShell width="wide">
      <header className="mb-5 flex items-center justify-between lg:mb-8">
        <div className="flex items-center gap-2.5">
          {/* 字标在桌面已由侧栏承担品牌，这里仅移动端显示，避免重复 */}
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white shadow-card lg:hidden">
            小M
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
              记录此刻
            </h1>
            <p className="text-xs text-zinc-400 lg:mt-1 lg:text-sm">想留住的，先记下来</p>
          </div>
        </div>
      </header>

      {/* 桌面双栏：左侧捕获区 / 右侧概览（待复习 + 知识概览 + 最近捕获）；移动端单列堆叠，捕获在最上。
          大屏右栏随宽度略增、间距加大，避免左侧录入栏过宽空荡、两栏比例失衡。 */}
      <div className="flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-10 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div>
          {/* 记录类型分段切换（底部 tab 栏让位给全局导航） */}
          <div
            role="tablist"
            aria-label="记录类型"
            className="mb-5 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/80"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] py-2.5 text-sm transition duration-200 ease-smooth focus-visible:outline-none',
                  tab === t.key
                    ? 'bg-white font-semibold text-brand shadow-card dark:bg-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                )}
              >
                <t.Icon aria-hidden className="h-[18px] w-[18px]" />
                {t.label}
              </button>
            ))}
          </div>

          <div key={tab} className="animate-fade-in">
            {tab === 'text' && <TextCapture {...handlers} />}
            {tab === 'voice' && <VoiceCapture {...handlers} />}
            {tab === 'link' && <LinkCapture {...handlers} />}
          </div>

          {/* 首次使用引导：一句话点明「记下后会发生什么」，降低上手门槛；附「使用帮助」入口。 */}
          <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-zinc-400">
            <AiIcon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-brand/70" />
            <span>
              随手记下想法、剪藏链接或说一段话，小M 会自动整理成概念，并按记忆曲线提醒你复习。
              新手可看{' '}
              <Link
                href="/guide"
                className="font-medium text-brand underline-offset-2 transition hover:underline focus-visible:outline-none"
              >
                使用帮助
              </Link>
              。
            </span>
          </p>

          {/* 移动端：概览（待复习 + 知识概览）+ 最近捕获，紧随捕获区之后。 */}
          <div className="mt-8 space-y-8 lg:hidden">
            <DashboardPanel />
            <RecentNotes items={recent} onTrash={removeNote} />
          </div>
        </div>

        {/* 桌面端：概览作为右栏常驻——待复习 / 知识概览 / 最近捕获。 */}
        <aside className="hidden space-y-6 lg:block">
          <DashboardPanel />
          <RecentNotes items={recent} onTrash={removeNote} keepWhenEmpty />
        </aside>
      </div>
    </PageShell>
  );
}
