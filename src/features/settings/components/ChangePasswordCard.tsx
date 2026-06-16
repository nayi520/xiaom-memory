'use client';

/**
 * 设置页「账户安全」卡片 —— 自助修改 / 设置密码（账户安全能力）。
 *
 * 挂载时 GET /api/me 取 { hasPassword }，据此决定形态：
 *   - 已设密码（邮箱+密码账户）：标题「修改密码」，显示「当前密码」必填 + 新密码 + 确认新密码。
 *   - 未设密码（Apple / magic-link 账户）：标题「设置密码」，**不显示当前密码框**，仅新密码 + 确认。
 *
 * 提交前前端兜底校验（新密码长度、两次一致、与当前不同），再 POST /api/profile/password；
 * 已鉴权端点做最终校验（应用层 userId 隔离）。成功/失败均用 Toast 反馈，保存中禁用并清空输入。
 *
 * 安全：明文密码仅在内存中短暂存在，提交后清空；不写日志、不持久化。
 */

import { useEffect, useState } from 'react';
import { Button, Input, cardClass, useToast, cn } from '@/components/ui';

/** 密码最小长度（与 /api/profile/password、password.ts 的 MIN_PASSWORD_LENGTH 保持一致）。 */
const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordCard() {
  const toast = useToast();

  // null = 加载中；true/false = 是否已设密码（决定文案与当前密码框）。
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // 取账户是否已设密码（复用 /api/me 的 hasPassword）。
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { hasPassword?: boolean };
      })
      .then((data) => {
        if (cancelled) return;
        setHasPassword(Boolean(data.hasPassword));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = hasPassword === null && !loadFailed;
  const needsCurrent = hasPassword === true;
  const actionLabel = needsCurrent ? '修改密码' : '设置密码';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || hasPassword === null) return;

    // —— 前端兜底校验（端点会再校验一遍）——
    if (needsCurrent && !currentPassword) {
      toast.error('请输入当前密码');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`新密码至少需要 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    if (needsCurrent && newPassword === currentPassword) {
      toast.error('新密码不能与当前密码相同');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          // 无密码账户不发送 currentPassword 字段（设置密码场景）。
          needsCurrent ? { currentPassword, newPassword } : { newPassword }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `操作失败（${res.status}）`);

      // 成功：清空全部输入，避免明文残留；设置密码后该账户已变为「有密码」。
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setHasPassword(true);
      toast.success(needsCurrent ? '密码已修改' : '密码已设置');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn(cardClass(), 'space-y-4')}>
      {loadFailed ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          账户信息加载失败，请刷新后重试。
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {needsCurrent
              ? '修改用于邮箱登录的密码。'
              : '为账户设置一个登录密码，之后可用邮箱 + 密码登录。'}
          </p>

          {/* 当前密码：仅「已设密码」账户显示且必填 */}
          {needsCurrent && (
            <div className="space-y-1.5">
              <label
                htmlFor="current-password"
                className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                当前密码
              </label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                disabled={saving || loading}
                className="py-2.5 text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="new-password"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              新密码
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
              disabled={saving || loading}
              className="py-2.5 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="confirm-password"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              确认新密码
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              disabled={saving || loading}
              className="py-2.5 text-sm"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="md" loading={saving} disabled={loading}>
              {actionLabel}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
