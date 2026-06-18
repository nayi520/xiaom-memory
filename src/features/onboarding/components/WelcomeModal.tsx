'use client';

/**
 * 欢迎弹窗（V12 新手引导第一步）——用三步讲清小M核心：捕获 → AI 自动整理 → 间隔复习 / 问小M。
 *
 * 交互：
 *  - 居中 modal，半透明遮罩；标题 + 三步图文 + 「开始使用」主 CTA。
 *  - 可选「一键添加示例笔记」：调 POST /api/onboarding/sample 创建 2–3 条可删除示例，让首页不空屏。
 *  - 关闭（开始使用 / 右上角 ×）即视为看过，落 onboarded（由上层 OnboardingProvider 处理 onDone）。
 *
 * a11y / 体验：role=dialog + aria-modal；Esc 关闭；焦点进入弹窗；reduced-motion 下不做位移动画
 *   （动画统一走 motion-safe:* 前缀 + globals 的 prefers-reduced-motion 兜底）。
 * 复用设计系统 token：glass / rounded-card / Button / lucide 图标，深浅色自适应。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  CloseIcon,
  TextIcon,
  AiIcon,
  ReviewIcon,
  AskIcon,
  CheckIcon,
  useToast,
  cn,
  type LucideIcon,
} from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

interface Step {
  Icon: LucideIcon;
  title: string;
  desc: string;
  /** 图标底座着色。 */
  tint: string;
}

const STEPS: Step[] = [
  {
    Icon: TextIcon,
    title: '随手捕获',
    desc: '想法、读到的要点、一段语音或一个链接——先记下来，不打断思路。',
    tint: 'text-brand bg-brand/10',
  },
  {
    Icon: AiIcon,
    title: 'AI 自动整理',
    desc: '小M 每晚把零散记录整理成概念，归入知识库，并生成复习卡片。',
    tint: 'text-violet-500 bg-violet-500/10',
  },
  {
    Icon: ReviewIcon,
    title: '按记忆曲线复习',
    desc: '在快要忘记时提醒你复习；也能随时「问小M」，让它基于你的记录作答。',
    tint: 'text-emerald-500 bg-emerald-500/10',
  },
];

export default function WelcomeModal({ onDone }: { onDone: () => void }) {
  const { success, error: toastError } = useToast();
  const [addingSample, setAddingSample] = useState(false);
  const [sampleAdded, setSampleAdded] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);

  // 进入时把焦点移入弹窗主 CTA；Esc 关闭。
  useEffect(() => {
    const t = setTimeout(() => startBtnRef.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone();
      }
      // 焦点陷阱：Tab 在弹窗内循环。
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const f = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        const act = document.activeElement;
        if (e.shiftKey && act === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && act === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDone]);

  const addSample = useCallback(async () => {
    if (addingSample || sampleAdded) return;
    setAddingSample(true);
    try {
      const res = await apiFetch('/api/onboarding/sample', {
        method: 'POST',
        timeoutMs: LONG_TIMEOUT_MS, // 生成示例可能涉及 AI，给更长超时
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        created?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? '添加失败');
      }
      setSampleAdded(true);
      success(
        data.created && data.created > 0
          ? '已添加示例记录，去首页看看吧'
          : '示例记录已经在你的记录里了'
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : '添加示例失败，请稍后再试');
    } finally {
      setAddingSample(false);
    }
  }, [addingSample, sampleAdded, success, toastError]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      {/* 遮罩：点击关闭（视为开始使用） */}
      <div
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm dark:bg-black/60"
        onClick={onDone}
      />

      <div
        ref={dialogRef}
        className="glass relative w-full max-w-md overflow-hidden rounded-card border border-zinc-200/80 shadow-pop motion-safe:animate-scale-in dark:border-zinc-700/80"
      >
        {/* 顶部品牌区 */}
        <div className="relative bg-gradient-to-br from-brand/[0.08] to-transparent px-6 pt-7 pb-5 text-center dark:from-brand/[0.12]">
          <button
            type="button"
            onClick={onDone}
            aria-label="关闭引导"
            className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100/70 hover:text-zinc-600 focus-visible:outline-none dark:hover:bg-zinc-800/60 dark:hover:text-zinc-300"
          >
            <CloseIcon aria-hidden className="h-4 w-4" />
          </button>
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-base font-bold text-white shadow-card">
            小M
          </span>
          <h2
            id="welcome-title"
            className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            欢迎来到小M
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            你负责遇见，小M 替你记得。三步就能上手：
          </p>
        </div>

        {/* 三步说明 */}
        <ul className="space-y-3.5 px-6 py-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3.5">
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  s.tint
                )}
              >
                <s.Icon aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <span className="text-xs font-bold tabular-nums text-zinc-300 dark:text-zinc-600">
                    {i + 1}
                  </span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {s.desc}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* 操作区 */}
        <div className="space-y-2.5 border-t border-zinc-200/70 px-6 py-4 dark:border-zinc-800/70">
          <Button ref={startBtnRef} fullWidth size="lg" onClick={onDone}>
            开始使用
          </Button>
          <Button
            variant="secondary"
            fullWidth
            size="md"
            onClick={addSample}
            loading={addingSample}
            disabled={sampleAdded}
          >
            {sampleAdded ? (
              <>
                <CheckIcon aria-hidden className="h-4 w-4 text-emerald-500" />
                示例已添加
              </>
            ) : (
              <>
                <AskIcon aria-hidden className="h-4 w-4" />
                先添加几条示例记录
              </>
            )}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-zinc-400">
            示例记录清晰标注、随时可删。之后可在「设置」里重看本引导。
          </p>
        </div>
      </div>
    </div>
  );
}
