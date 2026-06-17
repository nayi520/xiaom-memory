'use client';

/**
 * 摘要邮件开关（V17）：设置 profiles.settings.digestEmail = 'off'|'daily'|'weekly'。
 * cron/digest 每晚跑完整理后，据此用 DirectMail 把对应「最新一期」摘要邮件发到账号邮箱
 * （日报取当天 daily、周报取最新 weekly；无对应摘要则跳过，不发空邮件）。
 * 进入时拉取当前值；改动即 PATCH /api/settings 保存；未登录 / 网络异常优雅提示并回滚。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, MailIcon, useToast } from '@/components/ui';

type DigestEmailMode = 'off' | 'daily' | 'weekly';

const OPTIONS: { value: DigestEmailMode; label: string }[] = [
  { value: 'off', label: '不发送' },
  { value: 'daily', label: '每日摘要' },
  { value: 'weekly', label: '每周摘要' },
];

const LABEL: Record<DigestEmailMode, string> = {
  off: '不发送',
  daily: '每日摘要',
  weekly: '每周摘要',
};

export default function DigestEmailPicker() {
  const { success, error: toastError } = useToast();
  const [mode, setMode] = useState<DigestEmailMode>('off');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { settings?: { digestEmail?: DigestEmailMode } };
        if (cancelled) return;
        const m = data.settings?.digestEmail;
        if (m === 'off' || m === 'daily' || m === 'weekly') setMode(m);
      } catch {
        // 拉取失败：保留 off，不阻塞用户操作。
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onChange(next: DigestEmailMode) {
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ digestEmail: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      success(next === 'off' ? '已关闭摘要邮件' : `摘要邮件已设为「${LABEL[next]}」`);
    } catch (err) {
      setMode(prev);
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-100">
          <MailIcon aria-hidden className="h-4 w-4 text-sky-400" />
          摘要邮件
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          把每日整理 / 每周周报发到你的账号邮箱。
        </p>
      </div>
      <label className="relative shrink-0">
        <span className="sr-only">摘要邮件频率</span>
        <select
          value={mode}
          disabled={loading || saving}
          onChange={(e) => onChange(e.target.value as DigestEmailMode)}
          className="appearance-none rounded-field border border-zinc-300 bg-white py-2 pl-3.5 pr-9 text-base font-medium shadow-sm outline-none transition hover:border-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-zinc-400"
        />
      </label>
    </div>
  );
}
