'use client';

/**
 * 新手引导状态（V12）——单一事实源是 profiles.settings.onboarded（经 /api/settings 读写，不新增迁移）。
 *
 * 为什么还要 localStorage 缓存：
 *  - /api/settings 是异步的，首屏拿不到 onboarded 会让欢迎弹窗「闪一下又消失」或反复出现；
 *    本地缓存让「已引导过」的用户**立即**判定为完成，避免重复打扰，再以服务端为准对齐。
 *  - 缓存仅用于**抑制**展示（只缓存「已完成」），不会让真·新用户错过引导：缓存缺失时回退到服务端判断。
 *
 * 跨设备 / 多端：以服务端 onboarded 为最终事实；本地缓存只是同一浏览器内的加速。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 已引导过的本地缓存键（仅缓存「完成」态，用于抑制重复展示）。 */
const DONE_KEY = 'mxiao.onboarding.done.v1';

/** 自定义事件名：设置页「重看引导」dispatch 它，让全局 OnboardingProvider 重新触发引导。 */
export const ONBOARDING_RESTART_EVENT = 'xiaom:restart-onboarding';

/** 供设置页等入口触发「重看引导」：清本地完成态 + 通知全局 Provider 重新展示。 */
export function requestRestartOnboarding() {
  clearLocalDone();
  // 同步把服务端置回 false（跨设备/清缓存后仍能再次看到）。失败不阻断本地重看。
  fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ onboarded: false }),
  }).catch(() => {
    /* ignore */
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ONBOARDING_RESTART_EVENT));
  }
}

export type OnboardingPhase =
  /** 还在读取服务端/本地状态，未决定是否展示。 */
  | 'loading'
  /** 需要展示新手引导（首次）。 */
  | 'needed'
  /** 已引导过，不再展示。 */
  | 'done';

function readLocalDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLocalDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* 隐私模式等写不进去：本次会话内仍以内存态生效 */
  }
}

function clearLocalDone() {
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    /* ignore */
  }
}

export interface OnboardingApi {
  phase: OnboardingPhase;
  /** 把引导标记为完成（PATCH settings.onboarded=true + 落本地缓存），幂等。 */
  complete: () => void;
}

/**
 * 读取并管理新手引导是否需要展示。
 * 流程：先读本地缓存（已完成则直接 done，不闪）；再 GET /api/settings 以服务端 onboarded 校正。
 * 另订阅 ONBOARDING_RESTART_EVENT：设置页「重看引导」触发时，phase 回到 needed 重新展示。
 */
export function useOnboarding(): OnboardingApi {
  const [phase, setPhase] = useState<OnboardingPhase>('loading');
  // 防止卸载后 setState。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    // 本地已标记完成：立即定为 done，避免欢迎弹窗闪现。
    if (readLocalDone()) {
      setPhase('done');
      return;
    }
    let cancelled = false;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { settings?: { onboarded?: boolean } } | null) => {
        if (cancelled || !aliveRef.current) return;
        const onboarded = data?.settings?.onboarded === true;
        if (onboarded) {
          writeLocalDone();
          setPhase('done');
        } else {
          setPhase('needed');
        }
      })
      .catch(() => {
        // 取设置失败（离线/未登录等）：保守不打扰，视作已完成，不在不确定时弹引导。
        if (!cancelled && aliveRef.current) setPhase('done');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 设置页「重看引导」：清完成态（已由 requestRestartOnboarding 处理）后，让 phase 回 needed 重新展示。
  useEffect(() => {
    const onRestart = () => {
      if (aliveRef.current) setPhase('needed');
    };
    window.addEventListener(ONBOARDING_RESTART_EVENT, onRestart);
    return () => window.removeEventListener(ONBOARDING_RESTART_EVENT, onRestart);
  }, []);

  const complete = useCallback(() => {
    writeLocalDone();
    setPhase('done');
    // 服务端持久化（失败不影响本地体验，下次仍以本地完成态抑制）。
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ onboarded: true }),
    }).catch(() => {
      /* 网络失败：本地缓存已抑制重复展示，静默 */
    });
  }, []);

  return { phase, complete };
}
