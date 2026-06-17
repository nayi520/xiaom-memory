'use client';

/**
 * 「添加到主屏」安装引导（V10）。
 *
 * 监听 beforeinstallprompt（Chrome/Edge/Android 等支持的浏览器），在合适时机弹出一条
 * 轻量横幅引导用户安装为 PWA；点击「添加」调用原生 prompt()，「以后再说」则本轮关闭并
 * 记住偏好（localStorage），一段时间内不再打扰。已安装（standalone）或已忽略则不显示。
 *
 * 合适时机：拦截到事件后**延迟若干秒**再显示（避免一进站就打断），且仅在用户产生过
 *   一定交互（这里以「首次拦截到事件 + 延时」近似）后出现，符合「不打扰」原则。
 *
 * iOS Safari 不支持 beforeinstallprompt：检测到 iOS 且非 standalone 时，
 *   给一条「分享 → 添加到主屏幕」的纯文案提示（同样可忽略、可记住）。
 */

import { useEffect, useState } from 'react';
import { Share, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, CloseIcon, cn } from '@/components/ui';

const DISMISS_KEY = 'mxiao.pwa.install.dismissed.v1';
/** 忽略后冷静期（毫秒）：14 天内不再弹。 */
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/** 拦截到事件后延迟显示（毫秒），避免一进站就打断。 */
const SHOW_DELAY_MS = 4000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari 专有
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** 近期是否已忽略（在冷静期内）。 */
function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return true; // 老格式（非时间戳）：视为已忽略
    return Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  // iOS 文案提示（无 beforeinstallprompt 时的兜底）。
  const [iosHint, setIosHint] = useState(false);
  // iOS 分步图示展开态（默认折叠成一句话，点「查看步骤」展开）。
  const [iosExpanded, setIosExpanded] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // 阻止浏览器默认 mini-infobar，改由我们择时引导
      setDeferred(e as BeforeInstallPromptEvent);
      timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS：无安装事件，延时给一条「添加到主屏幕」文案提示。
    if (isIos()) {
      timer = setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  function remember() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  function dismiss() {
    setVisible(false);
    remember();
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* 用户取消 / 不支持：静默 */
    } finally {
      setVisible(false);
      setDeferred(null);
      remember();
    }
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="添加到主屏"
      className={cn(
        // 贴底浮层，避开底部导航（safe-area + 底栏高度），桌面右下。
        'fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)+4.75rem))] sm:inset-x-auto sm:right-6 sm:max-w-sm sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]'
      )}
    >
      <div className="glass motion-safe:animate-fade-in-up flex items-start gap-3 rounded-card border border-zinc-200/80 p-4 shadow-pop ring-1 ring-black/[0.02] dark:border-zinc-700/80">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white shadow-card">
          小M
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            把小M添加到主屏
          </p>
          {iosHint ? (
            <>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                像 App 一样全屏使用、秒开、接收复习提醒。
              </p>
              {/* 折叠的分步图示：默认收起，点开看「分享 → 添加到主屏幕」两步带图标。 */}
              <button
                type="button"
                onClick={() => setIosExpanded((v) => !v)}
                aria-expanded={iosExpanded}
                className="mt-1.5 inline-flex items-center gap-0.5 rounded-md text-xs font-medium text-brand underline-offset-2 transition hover:underline focus-visible:outline-none"
              >
                {iosExpanded ? '收起步骤' : '查看添加步骤'}
                {iosExpanded ? (
                  <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                )}
              </button>
              {iosExpanded && <IosSteps />}
            </>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              全屏使用、秒开、可离线记录、接收复习提醒。
            </p>
          )}
          {!iosHint && (
            <div className="mt-3 flex items-center gap-2">
              {/* 触控友好：md 尺寸（≥44px 高），主次操作并排。 */}
              <Button size="md" onClick={install}>
                添加到主屏
              </Button>
              <Button size="md" variant="ghost" onClick={dismiss}>
                以后再说
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭"
          className="touch-target -mr-2 -mt-2 flex shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <CloseIcon aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * iOS Safari「添加到主屏幕」分步图示。
 * 用真实对应的图标（分享、加号）+ 序号，贴近用户在 Safari 工具栏 / 分享菜单看到的样子，
 * 比纯文案更易跟做。仅在 iOS 兜底提示展开时渲染。
 */
function IosSteps() {
  const steps: { n: number; icon: React.ReactNode; text: React.ReactNode }[] = [
    {
      n: 1,
      icon: <Share aria-hidden className="h-4 w-4" />,
      text: (
        <>
          点底部工具栏的「分享」<span className="font-medium text-zinc-700 dark:text-zinc-200">􀈂</span>
        </>
      ),
    },
    {
      n: 2,
      icon: <Plus aria-hidden className="h-4 w-4" />,
      text: (
        <>
          在菜单里选「
          <span className="font-medium text-zinc-700 dark:text-zinc-200">添加到主屏幕</span>」
        </>
      ),
    },
  ];
  return (
    <ol className="motion-safe:animate-fade-in mt-2.5 space-y-2 border-t border-zinc-200/70 pt-2.5 dark:border-zinc-700/70">
      {steps.map((s) => (
        <li key={s.n} className="flex items-center gap-2.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">
            {s.n}
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-brand dark:border-zinc-700 dark:bg-zinc-900">
            {s.icon}
          </span>
          <span className="min-w-0 leading-relaxed">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
