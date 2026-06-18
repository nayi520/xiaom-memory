'use client';

import { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { Input, useToast, cn } from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

const MAX_SECONDS = 180; // 上限 3 分钟

type RecState = 'idle' | 'recording' | 'saving';

export default function VoiceCapture({
  addOptimistic,
  confirmNote,
  updateNote,
  failNote,
}: CaptureHandlers) {
  const [state, setState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [why, setWhy] = useState('');
  const { error: toastError } = useToast();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void saveRecording();
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setState('recording');
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      toastError('无法访问麦克风，请检查浏览器权限');
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') {
      setState('saving');
      recorderRef.current.stop();
    }
  }

  async function saveRecording() {
    // 把本次音频固化进闭包：重试时复用同一 blob（chunksRef 会被下次录音覆盖，故不能依赖它）。
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const whyText = why.trim() || null;
    setWhy('');
    setState('idle');
    void uploadAndSave(blob, whyText);
  }

  /** 上传音频 → 建 note → 异步转写。失败任一步都挂「重试」回调（用同一 blob 重跑）。 */
  async function uploadAndSave(blob: Blob, whyText: string | null) {
    const retry = () => uploadAndSave(blob, whyText);

    // 乐观上屏
    const temp = makeTempNote({
      type: 'voice',
      raw_content: '语音记录',
      why_important: whyText,
      hint: '上传中…',
    });
    addOptimistic(temp);

    // 1. 上传音频到 OSS —— 改走 /api/audio（服务端取 userId 落 OSS，返回对象 key）。
    //    去 Supabase：不再浏览器端 supabase.storage.upload；key 即 media_path（含 audio/ 前缀）。
    let mediaPath: string;
    try {
      const upRes = await apiFetch('/api/audio', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
        timeoutMs: LONG_TIMEOUT_MS, // 二进制上传，慢网下给更长超时
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.key) {
        failNote(temp.id, upData.error || '音频上传失败', retry);
        return;
      }
      mediaPath = upData.key as string;
    } catch {
      failNote(temp.id, '音频上传失败', retry);
      return;
    }

    // 2. 先建 note（不等转写）—— 改走 /api/notes（Drizzle 落库）
    let note: Note;
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'voice',
          media_path: mediaPath,
          why_important: whyText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.note) {
        failNote(temp.id, data.error || '保存失败', retry);
        return;
      }
      note = data.note as Note;
    } catch {
      failNote(temp.id, '网络错误，保存失败', retry);
      return;
    }
    // 处理态分步反馈：上传(已完成) → 转写 · AI 整理中… → 完成。
    // /api/transcribe 一次完成「ASR 转写 + P8 AI 总结」，故合并标注这一加工阶段，spinner 表「仍在加工」。
    confirmNote(temp.id, note, '转写 · AI 整理中…');

    // 3. 异步转写 + AI 总结（服务端一次完成），不阻塞。
    try {
      const res = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
        timeoutMs: LONG_TIMEOUT_MS, // 转写 + 总结可能数十秒
      });
      const result = await res.json();
      if (result.transcribed) {
        // 与详情页保持一致：AI 总结成功时正文用结构化 raw_content（🔑要点/✅待办/👥涉及），
        // 并写入 summary 供「AI 摘要」展示；未总结（降级）时回退展示纯转写文本。
        // transcript 始终保留原始转写（详情页「查看原始转写」折叠区用）。
        updateNote(note.id, {
          transcript: result.transcript,
          raw_content: result.summarized
            ? (result.raw_content ?? result.transcript)
            : result.transcript,
          summary: result.summarized ? result.summary : undefined,
          hint: undefined,
        });
      } else {
        updateNote(note.id, { hint: result.message || '转写待配置' });
      }
    } catch {
      updateNote(note.id, { hint: '转写失败，音频已保存' });
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const recording = state === 'recording';

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center rounded-card border border-zinc-200/80 bg-white py-12 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-7 items-center">
          {recording && (
            <p className="font-mono text-2xl font-semibold tabular-nums text-red-500">
              {mm}:{ss}
            </p>
          )}
        </div>
        <div className="relative mt-3 flex h-24 w-24 items-center justify-center">
          {/* 录音时的呼吸光环 */}
          {recording && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500/25" />
              <span className="absolute inset-2 animate-pulse rounded-full bg-red-500/15" />
            </>
          )}
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={state === 'saving'}
            className={cn(
              'relative flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white shadow-pop transition duration-200 ease-smooth active:scale-95 disabled:opacity-50',
              recording
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-gradient-to-br from-brand to-brand-dark hover:shadow-card-hover'
            )}
            aria-label={recording ? '停止录音' : '开始录音'}
          >
            {recording ? (
              <span className="block h-6 w-6 rounded-[5px] bg-white" />
            ) : (
              <MicGlyph />
            )}
          </button>
        </div>
        <p className="mt-5 text-sm text-zinc-500 dark:text-zinc-400">
          {recording
            ? '点击停止并保存'
            : state === 'saving'
              ? '保存中…'
              : `点击开始录音（最长 ${MAX_SECONDS / 60} 分钟）`}
        </p>
      </div>

      <Input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="为什么觉得重要？（一句话，可不填）"
        className="px-4 py-2.5 text-sm"
      />
    </div>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
