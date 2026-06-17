'use client';

/**
 * 安静时段选择器（V17）：设置 profiles.settings.quietHours = {start,end}（两个北京整点）。
 * 提醒/推送（cron/remind）在该时段内静默，即便到达提醒时间也不打扰。
 * 开关「启用」时给默认 22:00–07:00；关闭则 PATCH quietHours:null 清除。改起止整点即保存。
 * 进入时拉取当前值；未登录 / 网络异常优雅提示并回滚。允许跨午夜（start>end）。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, MoonIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface QuietHours {
  start: number;
  end: number;
}

/** 启用时的默认安静时段（22:00–07:00，跨午夜）。 */
const DEFAULT_QUIET: QuietHours = { start: 22, end: 7 };

function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export default function QuietHoursPicker() {
  const { success, error: toastError } = useToast();
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch('/api/settings');
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { settings?: { quietHours?: QuietHours | null } };
        if (cancelled) return;
        const qh = data.settings?.quietHours;
        if (
          qh &&
          Number.isInteger(qh.start) &&
          Number.isInteger(qh.end) &&
          qh.start !== qh.end
        ) {
          setQuiet({ start: qh.start, end: qh.end });
        }
      } catch {
        // 拉取失败：当作未启用，不阻塞用户操作。
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 提交给后端（next=null 表示清除）。失败回滚到 prev。 */
  async function save(next: QuietHours | null, prev: QuietHours | null, okMsg: string) {
    setQuiet(next);
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quietHours: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      success(okMsg);
    } catch (err) {
      setQuiet(prev);
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const enabled = quiet !== null;

  function onToggle() {
    if (enabled) {
      void save(null, quiet, '已关闭安静时段');
    } else {
      void save(DEFAULT_QUIET, null, '已开启安静时段');
    }
  }

  function onChangeStart(start: number) {
    if (!quiet || start === quiet.end) return;
    void save({ start, end: quiet.end }, quiet, '安静时段已更新');
  }
  function onChangeEnd(end: number) {
    if (!quiet || end === quiet.start) return;
    void save({ start: quiet.start, end }, quiet, '安静时段已更新');
  }

  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-100">
            <MoonIcon aria-hidden className="h-4 w-4 text-indigo-400" />
            安静时段
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {enabled
              ? `每天 ${formatHour(quiet!.start)}–${formatHour(quiet!.end)}（北京时间）不推送提醒。`
              : '开启后，所选时段内不发送复习提醒与推送。'}
          </p>
        </div>
        {/* 启用开关 */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="启用安静时段"
          disabled={loading || saving}
          onClick={onToggle}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50',
            enabled ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-700',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            ].join(' ')}
          />
        </button>
      </div>

      {/* 起止整点（仅启用时显示） */}
      {enabled && (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <HourSelect
            label="开始"
            value={quiet!.start}
            disabledHour={quiet!.end}
            disabled={loading || saving}
            onChange={onChangeStart}
          />
          <span className="text-sm text-zinc-400">至</span>
          <HourSelect
            label="结束"
            value={quiet!.end}
            disabledHour={quiet!.start}
            disabled={loading || saving}
            onChange={onChangeEnd}
          />
        </div>
      )}
    </div>
  );
}

/** 整点下拉（0–23，排除与另一端相同的整点，避免空区间）。 */
function HourSelect({
  label,
  value,
  disabledHour,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabledHour: number;
  disabled: boolean;
  onChange: (h: number) => void;
}) {
  return (
    <label className="relative inline-flex flex-1 items-center">
      <span className="sr-only">{label}时间</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full appearance-none rounded-field border border-zinc-300 bg-white py-2 pl-3.5 pr-9 text-sm font-medium tabular-nums shadow-sm outline-none transition hover:border-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h} disabled={h === disabledHour}>
            {formatHour(h)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-zinc-400"
      />
    </label>
  );
}
