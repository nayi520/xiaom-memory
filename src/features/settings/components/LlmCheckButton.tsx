'use client';

import { useState } from 'react';
import { Button, Markdown, useToast, cardClass, cn } from '@/components/ui';
import { apiFetch, friendlyError, LONG_TIMEOUT_MS } from '@/lib/api';

/** /api/check-llm 返回契约（与 src/lib/llm-check.ts 的 LlmCheckResult 对齐）。 */
interface CheckResult {
  provider: string;
  baseUrl: string;
  modelFast: string;
  modelStrong: string;
  jsonMode: 'auto' | 'on' | 'off';
  apiKeyEnv: string;
  hasKey: boolean;
  ping: { ok: boolean; ms: number; model: string; error?: string };
  summary: { ok: boolean; sample?: string; keyPoints?: string[]; error?: string };
}

type State =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: CheckResult };

/**
 * 设置页「测试当前 AI 供应商」按钮：调 GET /api/check-llm，
 * 展示当前 provider / 模型 + chat ping 结果 + 一段示例 json 总结（成功绿 / 失败红可读提示）。
 * 用于用户把文本 AI 切到智谱 GLM / Kimi 后一键验证 provider/key 是否通 + 看总结质量。
 */
export default function LlmCheckButton() {
  const { error: toastError } = useToast();
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function run() {
    setState({ phase: 'running' });
    try {
      const res = await apiFetch('/api/check-llm', { timeoutMs: LONG_TIMEOUT_MS });
      const data = await res.json();
      if (!res.ok) {
        toastError(data?.error ?? `请求失败（${res.status}）`);
        setState({ phase: 'idle' });
        return;
      }
      setState({ phase: 'done', result: data as CheckResult });
    } catch (err) {
      toastError(friendlyError(err, '自检请求失败，请稍后重试'));
      setState({ phase: 'idle' });
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={run}
        loading={state.phase === 'running'}
      >
        {state.phase === 'running' ? '正在测试当前 AI 供应商…' : '测试当前 AI 供应商'}
      </Button>

      {state.phase === 'done' && <CheckReport result={state.result} />}
    </div>
  );
}

/** 自检结果卡片：provider/模型概览 + ping + 示例总结，各项成功绿 / 失败红。 */
function CheckReport({ result }: { result: CheckResult }) {
  return (
    <div className="animate-fade-in space-y-3">
      {/* 概览：provider + base + 模型 + key 状态 */}
      <div
        className={cn(
          cardClass({ padded: false }),
          'space-y-1.5 px-4 py-3.5 text-sm text-zinc-600 dark:text-zinc-300'
        )}
      >
        <p className="font-semibold text-zinc-800 dark:text-zinc-100">
          供应商：{result.provider}
        </p>
        <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{result.baseUrl}</p>
        <p>
          模型：
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            {result.modelFast}
          </span>
          （fast）·{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            {result.modelStrong}
          </span>
          （strong）
        </p>
        <p className="text-xs text-zinc-400">
          JSON 模式：{result.jsonMode} · 密钥（{result.apiKeyEnv}）：
          {result.hasKey ? '已配置' : '未配置'}
        </p>
      </div>

      {/* chat ping 结果 */}
      <ResultRow
        ok={result.ping.ok}
        title={
          result.ping.ok
            ? `连接正常 · ${result.ping.ms}ms · ${result.ping.model}`
            : '连接失败'
        }
        body={result.ping.error}
      />

      {/* json 总结实测结果 */}
      <ResultRow
        ok={result.summary.ok}
        title={result.summary.ok ? '示例总结成功' : '示例总结失败'}
        body={result.summary.error}
      >
        {result.summary.ok && result.summary.sample && (
          <div className="mt-1.5 space-y-2">
            <Markdown content={result.summary.sample} className="text-sm" />
            {result.summary.keyPoints && result.summary.keyPoints.length > 0 && (
              <ul className="ml-5 list-disc space-y-1 text-sm marker:text-zinc-400">
                {result.summary.keyPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ResultRow>
    </div>
  );
}

/** 单项结果行：成功绿底 / 失败红底，标题 + 可选正文（错误原因或示例内容）。 */
function ResultRow({
  ok,
  title,
  body,
  children,
}: {
  ok: boolean;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-card border p-4 text-sm',
        ok
          ? 'border-emerald-200/80 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
          : 'border-red-200/80 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
      )}
    >
      <p className="font-semibold">
        {ok ? '✅ ' : '❌ '}
        {title}
      </p>
      {body && <p className="mt-1 break-words opacity-90">{body}</p>}
      {children}
    </div>
  );
}
