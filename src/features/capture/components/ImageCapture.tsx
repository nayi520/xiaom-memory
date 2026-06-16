'use client';

import { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { Input, ImageIcon, useToast, cn } from '@/components/ui';

/** 允许的图片类型（与 /api/images 服务端白名单一致）。 */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** 前端预检上限：10MB（与服务端 MAX_IMAGE_BYTES 缺省一致；服务端仍会再校验）。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 把逗号/顿号/空白分隔的标签串解析为去重数组（去掉前导 #）。 */
function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,，、\s]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
    )
  );
}

export default function ImageCapture({
  addOptimistic,
  confirmNote,
  updateNote,
  failNote,
}: CaptureHandlers) {
  const [why, setWhy] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  // 指向「最新」的 handleFile：粘贴监听只绑定一次，但需读到当前 why/tags/busy，避免闭包过期。
  const handleFileRef = useRef<(file: File) => void>(() => {});
  const { error: toastError } = useToast();

  // 卸载时回收本地预览 objectURL，避免内存泄漏。
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /** 粘贴图片（聚焦在拖拽区时）：从剪贴板取第一张图片。经 ref 调用最新 handleFile。 */
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFileRef.current(file);
            return;
          }
        }
      }
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
  }, []);

  function pickFile() {
    inputRef.current?.click();
  }

  function handleFile(file: File) {
    if (busy) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      toastError('图片仅支持 PNG / JPEG / WebP');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toastError('图片不能超过 10MB');
      return;
    }
    // 即时本地预览（提交时复用同一 file）。
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    const whyText = why.trim() || null;
    const tags = parseTags(tagsInput);
    setWhy('');
    setTagsInput('');
    void uploadAndSave(file, whyText, tags);
  }
  // 每次渲染把 ref 指向最新 handleFile，供一次性绑定的粘贴监听调用（读到当前 why/tags/busy）。
  handleFileRef.current = handleFile;

  /** 上传图片 → 建 image note →（可选）写标签 → 触发 OCR。失败任一步挂「重试」回调（用同一 file）。 */
  async function uploadAndSave(file: File, whyText: string | null, tags: string[]) {
    const retry = () => uploadAndSave(file, whyText, tags);
    setBusy(true);

    // 乐观上屏。
    const temp = makeTempNote({
      type: 'image',
      raw_content: '图片记录',
      why_important: whyText,
      hint: '上传中…',
    });
    addOptimistic(temp);

    // 1. 上传图片到 OSS（/api/images，服务端取 userId 落 OSS，返回对象 key=media_path，含 images/ 前缀）。
    let mediaPath: string;
    try {
      const form = new FormData();
      form.append('file', file);
      const upRes = await fetch('/api/images', { method: 'POST', body: form });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.key) {
        setBusy(false);
        failNote(temp.id, upData.error || '图片上传失败', retry);
        return;
      }
      mediaPath = upData.key as string;
    } catch {
      setBusy(false);
      failNote(temp.id, '图片上传失败', retry);
      return;
    }

    // 2. 先建 note（不等 OCR）—— /api/notes（type:'image'）。
    let note: Note;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          media_path: mediaPath,
          why_important: whyText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) {
        setBusy(false);
        failNote(temp.id, data.error || '保存失败', retry);
        return;
      }
      note = data.note as Note;
    } catch {
      setBusy(false);
      failNote(temp.id, '网络错误，保存失败', retry);
      return;
    }
    confirmNote(temp.id, note, 'OCR 识别中…');
    setBusy(false);

    // 3a. 标签（可选，复用 /api/library/note-tags）—— 不阻塞、失败不影响主流程。
    if (tags.length > 0) {
      void fetch('/api/library/note-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id, tags }),
      }).catch(() => {
        /* 标签写入失败静默：主记录已落库，可在详情页/列表重试修正 */
      });
    }

    // 3b. 异步 OCR，不阻塞。OCR 文本写回 raw_content（进搜索 + AI 整理）。
    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
      });
      const result = await res.json().catch(() => ({}));
      if (result.ocr) {
        updateNote(note.id, {
          raw_content: result.text,
          transcript: result.text,
          hint: undefined,
        });
      } else {
        updateNote(note.id, { hint: result.message || 'OCR 待配置' });
      }
    } catch {
      updateNote(note.id, { hint: 'OCR 失败，图片已保存' });
    }
  }

  return (
    <div className="space-y-4">
      <div
        ref={dropRef}
        tabIndex={0}
        role="button"
        aria-label="选择、拖拽或粘贴图片"
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pickFile();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer?.files?.[0];
          if (file) handleFile(file);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed py-12 text-center transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          dragOver
            ? 'border-brand bg-brand/5'
            : 'border-zinc-300 bg-white hover:border-brand/60 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800/60'
        )}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="已选择的图片预览"
            className="max-h-44 max-w-full rounded-field border border-zinc-200/70 object-contain dark:border-zinc-800"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-white shadow-pop">
            <ImageIcon aria-hidden className="h-7 w-7" />
          </span>
        )}
        <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          {busy ? '上传中…' : '点击选择，或拖拽 / 粘贴图片'}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          支持 PNG / JPEG / WebP，最大 10MB。识别出的文字会自动整理。
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // 允许连续选同一文件：清空 value。
            e.target.value = '';
          }}
        />
      </div>

      <Input
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="标签（可选，用逗号分隔，如：截图，灵感）"
        className="px-4 py-2.5 text-sm"
      />
      <Input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="为什么觉得重要？（一句话，可不填）"
        className="px-4 py-2.5 text-sm"
      />
    </div>
  );
}
