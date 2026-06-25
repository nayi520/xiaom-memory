'use client';

/**
 * 记录详情页「复制为 Markdown / 分享」操作（V29 导出与分享）。
 *
 * 接收**服务端预先用 noteToMarkdown 拼好的 markdown 字符串**（详情页是 server component，
 * 拼装在服务端做，客户端只管复制/分享），避免把整套 note 数据再传一遍。
 *
 * - 复制：navigator.clipboard.writeText（HTTPS / localhost 下可用；失败回退选区 + execCommand）。
 * - 分享：navigator.share（移动端 / 支持的浏览器弹系统分享，可发到群）；
 *         不支持时**退回复制** + toast 提示「已复制，可粘贴分享」（不静默失败）。
 *
 * 隐私：分享/复制的内容即 markdown 文本本身，不含任何私有对象外链（附件仅注明类型，见 noteToMarkdown）。
 */

import { useState } from 'react';
import { Button, CopyIcon, CheckIcon, ShareIcon, useToast } from '@/components/ui';

/** 尽力把文本写入剪贴板：优先 Clipboard API，失败回退隐藏 textarea + execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退下方 execCommand */
  }
  // 回退：不安全上下文 / 无 Clipboard API（老浏览器）。
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function NoteExportActions({
  markdown,
  title,
}: {
  /** 服务端用 noteToMarkdown 拼好的整条记录 Markdown。 */
  markdown: string;
  /** 分享标题（系统分享面板用，一般取记录标题）。 */
  title?: string;
}) {
  const { success, error: toastError, info } = useToast();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyText(markdown);
    if (ok) {
      setCopied(true);
      success('已复制为 Markdown');
      // 2s 后还原图标（轻量反馈，不依赖 toast 是否还在）。
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toastError('复制失败，请手动选择内容复制');
    }
  }

  async function onShare() {
    // navigator.share 仅在安全上下文 + 支持的浏览器（多为移动端）可用。
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: title || '小M 记录', text: markdown });
        return;
      } catch (err) {
        // 用户取消分享（AbortError）不算错误，静默返回。
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 其余失败 → 退回复制。
      }
    }
    // 不支持分享 / 分享失败：退回复制并提示。
    const ok = await copyText(markdown);
    if (ok) info('已复制，可粘贴到聊天或笔记分享');
    else toastError('当前环境不支持分享，请手动复制内容');
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onCopy}
        aria-label="复制为 Markdown"
        title="复制为 Markdown"
      >
        {copied ? (
          <CheckIcon aria-hidden className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <CopyIcon aria-hidden className="h-3.5 w-3.5" />
        )}
        {copied ? '已复制' : '复制 Markdown'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onShare}
        aria-label="分享这条记录"
        title="分享"
      >
        <ShareIcon aria-hidden className="h-3.5 w-3.5" />
        分享
      </Button>
    </div>
  );
}
