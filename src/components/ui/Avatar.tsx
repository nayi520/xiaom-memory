'use client';

/**
 * 用户头像（可复用）。
 *
 * - 有签名 URL（src）时渲染圆形图片；图片加载失败自动回退到字符占位（避免破图）。
 * - 无头像时回退为 name/email 首字符 + 品牌色圆底（中文取首字，英文大写）。
 * - 纯展示组件，尺寸通过 `size`（像素）控制，默认 32。
 *
 * 头像 src 为 OSS 临时签名 URL（~1h），由调用方从 /api/me 取；本组件不负责取数/缓存。
 */

import { useEffect, useState } from 'react';
import { cn } from './cn';

export interface AvatarProps {
  /** 头像签名 URL；为空时显示字符占位。 */
  src?: string | null;
  /** 显示名（优先用于首字符与 alt）。 */
  name?: string | null;
  /** 邮箱（name 缺失时取首字符）。 */
  email?: string | null;
  /** 直径（像素），默认 32。 */
  size?: number;
  className?: string;
}

/** 从 name/email 取一个展示字符（都没有时用品牌占位「M」）。 */
function initialOf(name?: string | null, email?: string | null): string {
  const source = (name?.trim() || email?.trim() || '') as string;
  if (!source) return 'M';
  // Array.from 正确处理 emoji / 多字节首字符。
  const first = Array.from(source)[0] ?? 'M';
  return first.toUpperCase();
}

export default function Avatar({ src, name, email, size = 32, className }: AvatarProps) {
  // 图片加载失败时回退占位；src 变化时重置错误态。
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [src]);

  const showImage = Boolean(src) && !errored;
  const initial = initialOf(name, email);
  const label = name?.trim() || email?.trim() || '用户头像';
  // 字号约为直径的 0.45，跟随尺寸缩放。
  const fontSize = Math.round(size * 0.45);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
        !showImage &&
          'bg-gradient-to-br from-brand to-brand-dark font-semibold text-white',
        className
      )}
      style={{ width: size, height: size }}
      aria-label={showImage ? undefined : label}
      role={showImage ? undefined : 'img'}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- OSS 临时签名 URL，跳过 next/image 优化（域名不固定、URL 1h 失效）
        <img
          src={src as string}
          alt={label}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span style={{ fontSize, lineHeight: 1 }}>{initial}</span>
      )}
    </span>
  );
}
