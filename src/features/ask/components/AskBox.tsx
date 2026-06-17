'use client';

/**
 * 知识库问答（V9）：流式 + 多轮气泡 + 可点击引用 + 追问建议 + 会话内历史。
 *
 * 交互：
 *  - 提问 → POST /api/ask（stream:true，带最近多轮 history）→ SSE：先来源、再逐 token 流式答案、
 *    末尾追问建议。无 SSE 支持时自动回退非流式 JSON（向后兼容）。
 *  - 答案中的 [n] 角标可点击 → 跳到对应来源概念详情；来源卡片也可点击。
 *  - 追问 chips 点击发起追问；问答历史 localStorage 会话内保留，可一键清空。
 * 复用设计系统 ui 组件与 token，深浅色自适应；Enter 提交、Shift+Enter 换行。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Textarea,
  ChevronRight,
  AskIcon,
  TrashIcon,
  cardClass,
  cn,
} from '@/components/ui';
import AnswerMarkdown from './AnswerMarkdown';
import { notifySessionExpired } from '@/lib/api';

interface Source {
  /** 角标编号（与答案 [n] 一致） */
  n: number;
  conceptId?: string;
  noteId?: string;
  title: string;
  snippet?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  suggestions?: string[];
  /** 正在流式接收中（assistant） */
  streaming?: boolean;
  /** 出错信息（assistant） */
  error?: string;
}

const STORAGE_KEY = 'mxiao.ask.history.v1';
/** 提交时随上下文带的最近轮数（与后端 ASK_HISTORY_MAX_TURNS 量级一致） */
const SEND_HISTORY_TURNS = 6;

const SUGGESTIONS = [
  '我最近都在关注什么？',
  '帮我回忆一下关于专注力的内容',
  '我记过哪些和决策有关的概念？',
];

let idSeq = 0;
function newId(prefix: string) {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

/** 从历史消息派生发给后端的 history（仅取已完成、无错误的轮） */
function buildHistory(messages: ChatMessage[]) {
  return messages
    .filter((m) => !m.streaming && !m.error && m.content.trim().length > 0)
    .slice(-SEND_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));
}

export default function AskBox() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollAnchor = useRef<HTMLDivElement | null>(null);
  /** 各 assistant 气泡 DOM，用于点击来源角标时滚动到来源区 */
  const sourcesRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // 会话内历史：首次挂载从 localStorage 恢复（仅恢复已完成的消息）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) {
          setMessages(
            parsed
              .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
              .map((m) => ({ ...m, streaming: false }))
          );
        }
      }
    } catch {
      /* 损坏的本地数据忽略即可 */
    }
    setHydrated(true);
  }, []);

  // 持久化（流式进行中不写，结束后写入）。
  useEffect(() => {
    if (!hydrated || busy) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* 配额/隐私模式失败忽略 */
    }
  }, [messages, hydrated, busy]);

  // 新消息滚动到底部。
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m
        )
      );
    },
    []
  );

  // 点击答案中的 [n] 角标：优先跳概念详情；缺 conceptId 时滚到来源区。
  const onCite = useCallback(
    (assistantId: string, n: number, sources?: Source[]) => {
      const src = sources?.find((s) => s.n === n);
      if (src?.conceptId) {
        router.push(`/library/concept/${src.conceptId}`);
        return;
      }
      sourcesRefs.current.get(assistantId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    },
    [router]
  );

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;

      const userMsg: ChatMessage = { id: newId('u'), role: 'user', content: trimmed };
      const assistantId = newId('a');
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };

      // history 取「本次提问之前」已完成的轮。
      const history = buildHistory(messages);

      setQuestion('');
      setBusy(true);
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      try {
        const res = await fetch('/api/ask?stream=1', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ question: trimmed, history, stream: true }),
        });

        // 非 2xx 或非 SSE → 读取 JSON 错误/回退非流式渲染。
        const ctype = res.headers.get('content-type') ?? '';
        if (!res.ok || !res.body || !ctype.includes('text/event-stream')) {
          await handleNonStream(res, assistantId);
          return;
        }

        await consumeSse(res.body, assistantId);
      } catch (err) {
        patchMessage(assistantId, {
          streaming: false,
          error: err instanceof Error ? err.message : '网络错误，请稍后再试',
        });
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, messages]
  );

  // 回退：把一次普通 JSON 响应渲染进 assistant 气泡（兼容无 SSE 的环境/错误）。
  async function handleNonStream(res: Response, assistantId: string) {
    let data: {
      answer?: string;
      sources?: Source[];
      suggestions?: string[];
      error?: string;
    } = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      // 401：会话过期——触发全局重登引导（与 apiFetch 同口径），气泡内也给明确文案。
      if (res.status === 401) notifySessionExpired();
      patchMessage(assistantId, {
        streaming: false,
        error:
          res.status === 401
            ? data?.error ?? '登录已过期，请重新登录后再试'
            : data?.error ?? `请求失败（${res.status}）`,
      });
      return;
    }
    patchMessage(assistantId, {
      streaming: false,
      content: data.answer ?? '',
      sources: data.sources ?? [],
      suggestions: data.suggestions ?? [],
    });
  }

  // 消费 SSE：每行 `data: <json>`，按 type 累积。
  async function consumeSse(body: ReadableStream<Uint8Array>, assistantId: string) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt:
            | { type: 'sources'; sources: Source[] }
            | { type: 'token'; text: string }
            | { type: 'suggestions'; suggestions: string[] }
            | { type: 'done' }
            | { type: 'error'; message: string };
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.type === 'sources') {
            patchMessage(assistantId, { sources: evt.sources });
          } else if (evt.type === 'token') {
            patchMessage(assistantId, (m) => ({ content: m.content + evt.text }));
          } else if (evt.type === 'suggestions') {
            patchMessage(assistantId, { suggestions: evt.suggestions });
          } else if (evt.type === 'error') {
            patchMessage(assistantId, { streaming: false, error: evt.message });
          }
          // done：自然收尾，下方 finally 统一关流式态。
        }
      }
    } finally {
      reader.releaseLock();
      patchMessage(assistantId, { streaming: false });
    }
  }

  function clearHistory() {
    if (busy) return;
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    ask(question);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(question);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="space-y-5">
      {/* 对话流 */}
      {!empty && (
        <div className="space-y-4">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] animate-fade-in-up rounded-card rounded-br-sm bg-brand px-4 py-2.5 text-[15px] text-white shadow-card">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantBubble
                key={m.id}
                msg={m}
                busy={busy}
                onCite={(n) => onCite(m.id, n, m.sources)}
                onFollowUp={(s) => ask(s)}
                registerSourcesRef={(el) => sourcesRefs.current.set(m.id, el)}
              />
            )
          )}
          <div ref={scrollAnchor} />
        </div>
      )}

      {/* 输入区 */}
      <form onSubmit={onSubmit} className="space-y-3">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="向你的知识库提问，比如「我记过哪些关于习惯养成的概念？」"
          enterKeyHint="send"
          disabled={busy}
          aria-label="问题"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="lg" loading={busy} disabled={!question.trim()} className="flex-1">
            {busy ? '正在翻你的知识库…' : '提问'}
          </Button>
          {!empty && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={clearHistory}
              disabled={busy}
              aria-label="清空对话"
              title="清空对话"
            >
              <TrashIcon aria-hidden className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>

      {/* 空态：示例问题 */}
      {empty && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={busy}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 transition hover:border-brand hover:text-brand disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 单条 assistant 气泡：流式答案 + 来源卡片 + 追问 chips。 */
function AssistantBubble({
  msg,
  busy,
  onCite,
  onFollowUp,
  registerSourcesRef,
}: {
  msg: ChatMessage;
  busy: boolean;
  onCite: (n: number) => void;
  onFollowUp: (s: string) => void;
  registerSourcesRef: (el: HTMLDivElement | null) => void;
}) {
  const showCursor = msg.streaming && msg.content.length === 0;

  if (msg.error) {
    return (
      <p
        role="alert"
        className="animate-fade-in rounded-card border border-red-200 bg-red-50 p-3.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
      >
        {msg.error}
      </p>
    );
  }

  return (
    <div className="animate-fade-in space-y-3">
      <div className={cn(cardClass(), 'text-[15px]')}>
        {showCursor ? (
          <p className="flex items-center gap-2 text-zinc-400">
            <AskIcon aria-hidden className="h-4 w-4 animate-pulse" />
            正在思考…
          </p>
        ) : (
          <>
            <AnswerMarkdown content={msg.content} onCite={onCite} />
            {msg.streaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-text-bottom" />
            )}
          </>
        )}
      </div>

      {/* 来源卡片 */}
      {msg.sources && msg.sources.length > 0 && (
        <div ref={registerSourcesRef} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            来源 · {msg.sources.length} 个概念
          </p>
          <ul className="space-y-2">
            {msg.sources.map((s) => {
              const inner = (
                <>
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold tabular-nums text-brand">
                    {s.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-zinc-800 dark:text-zinc-100">
                      {s.title}
                    </span>
                    {s.snippet && (
                      <span className="mt-0.5 block truncate text-xs text-zinc-400">
                        {s.snippet}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
                  />
                </>
              );
              const cls = cn(
                cardClass({ interactive: true, padded: false }),
                'group flex items-start gap-3 px-4 py-3'
              );
              return (
                <li key={`${s.n}-${s.conceptId ?? s.noteId ?? s.title}`}>
                  {s.conceptId ? (
                    <Link href={`/library/concept/${s.conceptId}`} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 追问建议 */}
      {!msg.streaming && msg.suggestions && msg.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {msg.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onFollowUp(s)}
              disabled={busy}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 transition hover:border-brand hover:text-brand disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
