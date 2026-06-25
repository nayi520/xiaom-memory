'use client';

import { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { Input, useToast, cn } from '@/components/ui';
import { apiFetch, LONG_TIMEOUT_MS } from '@/lib/api';

// 录音时长安全上限：2 小时（足够整场会议）。原 3 分钟硬上限已移除，支持会议记录。
const MAX_SECONDS = 2 * 60 * 60;
// 异步转写轮询：间隔 + 前端最长等待（超时后交给 /api/cron/transcribe 兜底，提示稍后查看）。
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

type RecState = 'idle' | 'recording' | 'saving';
type Mode = 'note' | 'meeting';

export default function VoiceCapture({
  addOptimistic,
  confirmNote,
  updateNote,
  failNote,
  initialMode = 'note',
}: CaptureHandlers & {
  /** 首页「快捷记录 · 会议」深链时预选会议模式（默认语音速记）。 */
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [state, setState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [why, setWhy] = useState('');
  const { error: toastError } = useToast();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 把录制时所选模式固化进 onstop 闭包（保存时 state 可能已被下次操作改动）。
  const modeRef = useRef<Mode>('note');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer() {
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) stopRecording();
        return s + 1;
      });
    }, 1000);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      modeRef.current = mode;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void saveRecording();
      };
      // 长录音分片：每 10s 产出一个 chunk，降低超长录音的单块内存压力（停止时拼成整段）。
      recorder.start(10000);
      recorderRef.current = recorder;
      setSeconds(0);
      setPaused(false);
      setState('recording');
      startTimer();
    } catch {
      toastError('无法访问麦克风，请检查浏览器权限');
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setPaused(true);
      clearTimer();
    } else if (rec.state === 'paused') {
      rec.resume();
      setPaused(false);
      startTimer();
    }
  }

  function stopRecording() {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && (rec.state === 'recording' || rec.state === 'paused')) {
      setState('saving');
      setPaused(false);
      rec.stop();
    }
  }

  async function saveRecording() {
    // 把本次音频固化进闭包：重试时复用同一 blob（chunksRef 会被下次录音覆盖，故不能依赖它）。
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const whyText = why.trim() || null;
    const recMode = modeRef.current;
    setWhy('');
    setState('idle');
    void uploadAndSave(blob, whyText, recMode);
  }

  /** 上传音频 → 建 note → 启动异步转写 + 轮询。失败任一步都挂「重试」回调（用同一 blob 重跑）。 */
  async function uploadAndSave(blob: Blob, whyText: string | null, recMode: Mode) {
    const retry = () => uploadAndSave(blob, whyText, recMode);
    const label = recMode === 'meeting' ? '会议记录' : '语音记录';

    // 乐观上屏
    const temp = makeTempNote({
      type: 'voice',
      raw_content: label,
      why_important: whyText,
      hint: '上传中…',
    });
    addOptimistic(temp);

    // 1. 上传音频到 OSS —— /api/audio（服务端取 userId 落 OSS，返回对象 key=media_path）。
    let mediaPath: string;
    try {
      const upRes = await apiFetch('/api/audio', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
        timeoutMs: LONG_TIMEOUT_MS, // 长会议音频较大，慢网下给更长超时
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

    // 2. 先建 note（不等转写）—— /api/notes（Drizzle 落库）
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
    confirmNote(
      temp.id,
      note,
      recMode === 'meeting' ? '转写中 · 会议纪要整理…' : '转写 · AI 整理中…'
    );

    // 3. 启动异步转写（提交即返回），随后轮询 /api/transcribe/status 取结果。
    try {
      const res = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
      });
      const result = await res.json().catch(() => ({}));
      if (result.status === 'transcribing') {
        void pollTranscription(note.id, recMode);
      } else if (result.status === 'done' || result.transcribed) {
        // 兼容：后端若直接返回完成结果。
        applyTranscribed(note.id, result);
      } else {
        // 降级（待配置 / 启动失败）：保留音频，给出可读提示。
        updateNote(note.id, { hint: result.message || '转写待配置，音频已保存' });
      }
    } catch {
      // 提交请求异常 → 任务可能已创建，仍尝试轮询兜底。
      void pollTranscription(note.id, recMode);
    }
  }

  /** 轮询 /api/transcribe/status 直到 done/failed 或超时（超时后由 cron 兜底完成）。 */
  async function pollTranscription(noteId: string, recMode: Mode) {
    const deadline = Date.now() + POLL_MAX_MS;
    updateNote(noteId, {
      hint: recMode === 'meeting' ? '转写中 · 会议纪要整理…（可能需几分钟）' : '转写中…',
    });

    const tick = async (): Promise<void> => {
      if (Date.now() > deadline) {
        updateNote(noteId, { hint: '转写中，完成后会自动整理（可稍后刷新查看）' });
        return;
      }
      try {
        const res = await apiFetch(
          `/api/transcribe/status?noteId=${encodeURIComponent(noteId)}`,
          { method: 'GET', timeoutMs: LONG_TIMEOUT_MS }
        );
        const data = await res.json().catch(() => ({}));
        if (data.status === 'done') {
          applyTranscribed(noteId, data);
          return;
        }
        if (data.status === 'failed') {
          updateNote(noteId, { hint: data.message || '转写失败，音频已保存' });
          return;
        }
        // transcribing / idle → 继续轮询
      } catch {
        /* 网络抖动：忽略本次，继续轮询 */
      }
      setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  /** 把转写完成结果写回 note：正文用结构化 raw_content，summary 供「AI 摘要」展示。 */
  function applyTranscribed(
    noteId: string,
    data: { transcript?: string; raw_content?: string; summary?: string }
  ) {
    const transcript = data.transcript ?? '';
    updateNote(noteId, {
      transcript,
      raw_content: data.raw_content ?? transcript,
      summary: data.summary || undefined,
      hint: undefined,
    });
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const recording = state === 'recording';
  const idle = state === 'idle';

  return (
    <div className="space-y-4">
      {/* 模式切换：语音速记 / 会议记录（仅空闲时可切） */}
      <div
        role="tablist"
        aria-label="录音模式"
        className="mx-auto flex w-full max-w-xs rounded-full bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {(
          [
            { key: 'note', label: '语音速记' },
            { key: 'meeting', label: '会议记录' },
          ] as { key: Mode; label: string }[]
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            disabled={!idle}
            onClick={() => setMode(m.key)}
            className={cn(
              'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-60',
              mode === m.key
                ? 'bg-white text-brand shadow-sm dark:bg-zinc-700 dark:text-brand-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center rounded-card border border-zinc-200/80 bg-white py-12 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-7 items-center">
          {(recording || paused) && (
            <p
              className={cn(
                'font-mono text-2xl font-semibold tabular-nums',
                paused ? 'text-amber-500' : 'text-red-500'
              )}
            >
              {mm}:{ss}
            </p>
          )}
        </div>
        <div className="relative mt-3 flex h-24 w-24 items-center justify-center">
          {/* 录音时的呼吸光环（暂停时不动） */}
          {recording && !paused && (
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

        {/* 暂停 / 继续（录音中可用，适合会议中途暂停） */}
        {recording && (
          <button
            type="button"
            onClick={togglePause}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {paused ? '继续' : '暂停'}
          </button>
        )}

        <p className="mt-5 px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {recording
            ? paused
              ? '已暂停，点击「继续」接着录'
              : '点击停止并保存'
            : state === 'saving'
              ? '保存中…'
              : mode === 'meeting'
                ? '点击开始录音 · 适合会议，结束后自动转写并整理纪要'
                : '点击开始录音 · 适合随手语音速记'}
        </p>
      </div>

      <Input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder={
          mode === 'meeting'
            ? '会议主题 / 为什么重要？（可不填）'
            : '为什么觉得重要？（一句话，可不填）'
        }
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
