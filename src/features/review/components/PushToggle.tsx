'use client';

/**
 * 复习提醒开关（F3.2）：订阅 / 取消 Web Push。
 * 服务端未配置 VAPID 密钥时优雅降级（按钮禁用 + 提示）。
 */

import { useEffect, useState } from 'react';

type Phase =
  | 'loading' // 检测中
  | 'unsupported' // 浏览器不支持
  | 'unconfigured' // 服务端缺 VAPID 密钥
  | 'denied' // 用户拒绝了通知权限
  | 'off'
  | 'on'
  | 'busy';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  // 显式 ArrayBuffer，兼容 TS 5.7+ 对 PushManager applicationServerKey 的类型要求
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushToggle() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        setPhase('unsupported');
        return;
      }
      try {
        const res = await fetch('/api/push/subscribe');
        const data = (await res.json()) as { configured: boolean; publicKey: string | null };
        if (cancelled) return;
        if (!data.configured || !data.publicKey) {
          setPhase('unconfigured');
          return;
        }
        setPublicKey(data.publicKey);
        if (Notification.permission === 'denied') {
          setPhase('denied');
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPhase(sub ? 'on' : 'off');
      } catch {
        if (!cancelled) setPhase('off');
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setPhase('busy');
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPhase('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      setPhase('on');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '开启失败');
      setPhase('off');
    }
  }

  async function disable() {
    setPhase('busy');
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPhase('off');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '关闭失败');
      setPhase('on');
    }
  }

  if (phase === 'loading') {
    return <p className="text-xs text-zinc-400">检测推送支持…</p>;
  }
  if (phase === 'unsupported') {
    return (
      <p className="text-xs text-zinc-400">
        当前浏览器不支持 Web Push（iOS 需将小M添加到主屏幕后再开启）。
      </p>
    );
  }
  if (phase === 'unconfigured') {
    return (
      <div className="space-y-2">
        <button
          disabled
          className="w-full rounded-xl bg-zinc-200 py-3 font-semibold text-zinc-400 dark:bg-zinc-800"
        >
          开启每日复习提醒
        </button>
        <p className="text-xs text-amber-500">
          推送服务未配置：服务端缺少 VAPID 密钥（见 .env.example）。
        </p>
      </div>
    );
  }
  if (phase === 'denied') {
    return (
      <p className="text-xs text-amber-500">
        通知权限已被拒绝。请在浏览器设置中允许本站通知后刷新页面。
      </p>
    );
  }

  const on = phase === 'on';
  return (
    <div className="space-y-2">
      <button
        onClick={on ? disable : enable}
        disabled={phase === 'busy'}
        className={`w-full rounded-xl py-3 font-semibold transition active:opacity-80 disabled:opacity-50 ${
          on
            ? 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
            : 'bg-brand text-white'
        }`}
      >
        {phase === 'busy' ? '处理中…' : on ? '关闭复习提醒' : '开启每日复习提醒'}
      </button>
      <p className="text-xs text-zinc-400">
        {on
          ? '已开启：每天早上 8:00（北京时间）有到期卡片时推送提醒，点击直达复习页。'
          : '开启后，每天早上 8:00 有到期卡片时会收到推送提醒。'}
      </p>
      {message && <p className="text-xs text-red-500">{message}</p>}
    </div>
  );
}
