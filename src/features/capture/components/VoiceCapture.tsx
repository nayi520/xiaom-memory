'use client';

import { useEffect, useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';

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
  const [error, setError] = useState('');

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
    setError('');
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
      setError('无法访问麦克风，请检查浏览器权限');
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
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const whyText = why.trim() || null;

    // 乐观上屏
    const temp = makeTempNote({
      type: 'voice',
      raw_content: '🎙️ 语音记录',
      why_important: whyText,
      hint: '上传中…',
    });
    addOptimistic(temp);
    setWhy('');
    setState('idle');

    // 1. 上传音频到 OSS —— 改走 /api/audio（服务端取 userId 落 OSS，返回对象 key）。
    //    去 Supabase：不再浏览器端 supabase.storage.upload；key 即 media_path（含 audio/ 前缀）。
    let mediaPath: string;
    try {
      const upRes = await fetch('/api/audio', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.key) {
        failNote(temp.id, upData.error || '音频上传失败');
        return;
      }
      mediaPath = upData.key as string;
    } catch {
      failNote(temp.id, '音频上传失败');
      return;
    }

    // 2. 先建 note（不等转写）—— 改走 /api/notes（Drizzle 落库）
    let note: Note;
    try {
      const res = await fetch('/api/notes', {
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
        failNote(temp.id, data.error || '保存失败');
        return;
      }
      note = data.note as Note;
    } catch {
      failNote(temp.id, '网络错误，保存失败');
      return;
    }
    confirmNote(temp.id, note, '转写中…');

    // 3. 异步转写，不阻塞
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: note.id }),
      });
      const result = await res.json();
      if (result.transcribed) {
        updateNote(note.id, {
          transcript: result.transcript,
          raw_content: result.transcript,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center rounded-2xl border border-zinc-200 bg-white py-10 dark:border-zinc-800 dark:bg-zinc-900">
        {state === 'recording' && (
          <p className="mb-4 font-mono text-2xl tabular-nums text-red-500">
            {mm}:{ss}
            <span className="ml-2 inline-block h-3 w-3 animate-pulse rounded-full bg-red-500 align-middle" />
          </p>
        )}
        <button
          type="button"
          onClick={state === 'recording' ? stopRecording : startRecording}
          disabled={state === 'saving'}
          className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white shadow-lg transition active:scale-95 disabled:opacity-50 ${
            state === 'recording' ? 'bg-red-500' : 'bg-brand'
          }`}
          aria-label={state === 'recording' ? '停止录音' : '开始录音'}
        >
          {state === 'recording' ? '■' : '🎙️'}
        </button>
        <p className="mt-4 text-sm text-zinc-400">
          {state === 'recording'
            ? '点击停止并保存'
            : state === 'saving'
              ? '保存中…'
              : `点击开始录音（最长 ${MAX_SECONDS / 60} 分钟）`}
        </p>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      <input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="为什么觉得重要？（一句话，可不填）"
        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900"
      />
    </div>
  );
}
