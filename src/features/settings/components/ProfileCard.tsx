'use client';

/**
 * 设置页「个人资料」卡片（用户资料能力）。
 *
 * 挂载时 GET /api/me 取 { email, name, avatarUrl }，提供：
 *   - 圆形头像：点击触发文件选择（accept=image/*），上传中显示 spinner 遮罩；
 *     成功后用返回的现签 avatarUrl 即时更新，成功/失败均用 Toast 反馈。
 *   - 可编辑显示名：输入框 + 保存按钮 → PATCH /api/profile；保存中禁用；Toast 反馈。
 *   - 只读邮箱。
 *
 * 上传/保存均经已鉴权端点（应用层 userId 隔离）。头像 URL 为临时签名（~1h），不长期缓存。
 */

import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Input,
  cardClass,
  useToast,
  SpinnerIcon,
  cn,
} from '@/components/ui';

interface Me {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/** 头像前端兜底校验（与后端一致），避免明显非法请求白跑一趟。 */
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const NAME_MAX = 24;

export default function ProfileCard() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 初次加载资料。
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Me;
      })
      .then((data) => {
        if (cancelled) return;
        setMe(data);
        setNameInput(data.name ?? '');
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      toast.error(`显示名需为 1–${NAME_MAX} 个字符`);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `保存失败（${res.status}）`);
      setMe((prev) => (prev ? { ...prev, name: data.name ?? trimmed } : prev));
      setNameInput(data.name ?? trimmed);
      toast.success('显示名已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSavingName(false);
    }
  }

  function pickAvatar() {
    if (uploading) return;
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 重置 input，便于连续选同一文件也能再次触发 change。
    e.target.value = '';
    if (!file) return;

    if (!ACCEPT_TYPES.includes(file.type)) {
      toast.error('头像仅支持 PNG / JPEG / WebP');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('头像不能超过 5MB');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `上传失败（${res.status}）`);
      setMe((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl ?? null } : prev));
      toast.success('头像已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  const nameChanged = nameInput.trim() !== (me?.name ?? '');

  return (
    <div className={cn(cardClass(), 'flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6')}>
      {/* 头像：点击上传 */}
      <div className="flex shrink-0 flex-col items-center gap-2">
        <button
          type="button"
          onClick={pickAvatar}
          disabled={uploading}
          aria-label="更换头像"
          className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed"
        >
          <Avatar
            src={me?.avatarUrl}
            name={me?.name}
            email={me?.email}
            size={72}
            className="ring-2 ring-white shadow-card dark:ring-zinc-800"
          />
          {/* hover/上传遮罩 */}
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[11px] font-medium text-white transition-opacity',
              uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            {uploading ? (
              <SpinnerIcon aria-hidden className="h-5 w-5 animate-spin" />
            ) : (
              '更换'
            )}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* 显示名 + 邮箱 */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="profile-name"
            className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            显示名
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="profile-name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={NAME_MAX}
              placeholder={loadFailed ? '加载失败' : '给自己起个名字'}
              disabled={savingName || me === null}
              className="py-2.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameChanged && !savingName) {
                  e.preventDefault();
                  void handleSaveName();
                }
              }}
            />
            <Button
              type="button"
              size="md"
              onClick={() => void handleSaveName()}
              loading={savingName}
              disabled={!nameChanged || me === null}
            >
              保存
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            邮箱
          </span>
          <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
            {me?.email ?? (loadFailed ? '加载失败' : '—')}
          </p>
        </div>
      </div>
    </div>
  );
}
