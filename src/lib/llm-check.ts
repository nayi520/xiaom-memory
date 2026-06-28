/**
 * AI 供应商自检（chat ping + json 总结实测）—— 端点 /api/check-llm 与 dev 脚本 scripts/check-llm.ts 共用核心。
 *
 * 目的：用户把文本 AI 切到智谱 GLM / Kimi(moonshot) 等供应商后，一键验证 provider/key 是否通 +
 *       看一段示例总结判断质量。**不依赖数据库 / 鉴权 / 落库**，纯按当前 env 配置实测当前 chat 供应商：
 *   (a) chat ping：发一句最简提示，量 provider/key 是否可达 + 延迟 + 实际模型名；
 *   (b) json 总结实测：用一段**固定示例转写**跑 P8 prompt（llm.json），返回示例摘要 + 要点。
 *
 * **优雅返回**：缺 key / HTTP / 解析任何错误都不抛，转成 { ok:false, error }（指明 provider 与原因）。
 * 自检本身会真打两次付费调用，调用入口（路由）须先做按 userId 限流。
 */

import {
  createAnthropicClient,
  LlmKeyMissingError,
  type LlmClient,
} from './llm';
import { resolveLlmProvider, resolveLlmJsonMode, type LlmJsonMode } from './providers';
import {
  GLOBAL_SYSTEM,
  buildP8Prompt,
  type P8Result,
} from '@/features/digest/prompts';

/** chat ping 用的最简提示：让模型只回一个固定词，最省 token，仅验「能不能通 + 延迟 + 模型名」。 */
const PING_PROMPT = '请只回复两个字："你好"。不要输出其他任何内容。';

/**
 * json 总结实测用的固定示例转写（一段会议/速记口吻的中文文本，含可提炼的要点/待办/人时）。
 * 选短文本（< 会议阈值）以走轻量 P8（fast 档），既验 json 链路又控成本。
 */
export const SAMPLE_TRANSCRIPT =
  '今天上午跟产品和设计过了一下下个版本的方案。核心是把首页的记录入口做得更顺手，' +
  '语音速记转写完之后能自动出摘要和关键要点，这块大家都觉得是这个版本最重要的事。' +
  '李雷说他下周三之前把交互稿改完，韩梅梅负责把转写总结的接口联调好。' +
  '另外提到预算这块，这个季度市场投放先压到五万以内，等数据出来再追加。' +
  '最后定了下周二上午十点再碰一次，确认排期。';

export interface PingResult {
  ok: boolean;
  /** 往返耗时（毫秒，整数）。 */
  ms: number;
  /** 实测使用的模型名（取当前 provider 的 fast 档模型）。 */
  model: string;
  /** 失败时的人类可读原因（缺 key / HTTP / 空内容）。 */
  error?: string;
}

export interface SummaryCheckResult {
  ok: boolean;
  /** 成功时的示例摘要文本（2-3 句）。 */
  sample?: string;
  /** 成功时提炼出的关键要点（便于直观判断质量）。 */
  keyPoints?: string[];
  /** 失败时的人类可读原因。 */
  error?: string;
}

export interface LlmCheckResult {
  provider: string;
  baseUrl: string;
  modelFast: string;
  modelStrong: string;
  /** 当前 LLM_JSON_MODE（auto/on/off），便于排查 json 链路行为。 */
  jsonMode: LlmJsonMode;
  /** 该 provider 读取的 API Key env 名（便于提示用户配哪个变量）。 */
  apiKeyEnv: string;
  /** 是否已配置该 provider 的 key（不回显 key 本身）。 */
  hasKey: boolean;
  ping: PingResult;
  summary: SummaryCheckResult;
}

/** 把任意错误转成一句友好原因（缺 key 单独点名，便于用户立刻知道配哪个变量）。 */
function reason(err: unknown): string {
  if (err instanceof LlmKeyMissingError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** chat ping：最简一句话往返，量「通不通 + 延迟 + 模型名」。任何错误优雅转 { ok:false, error }。 */
async function runPing(llm: LlmClient, modelFast: string): Promise<PingResult> {
  const started = Date.now();
  try {
    const text = await llm.text(PING_PROMPT, {
      model: 'haiku', // fast 档，最省
      task: 'CHECK_PING',
      system: GLOBAL_SYSTEM,
    });
    const ms = Date.now() - started;
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      return { ok: false, ms, model: modelFast, error: '供应商返回空内容' };
    }
    return { ok: true, ms, model: modelFast };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, model: modelFast, error: reason(err) };
  }
}

/** json 总结实测：用固定示例转写跑 P8（llm.json），返回示例摘要 + 要点。任何错误优雅转 { ok:false, error }。 */
async function runSummary(llm: LlmClient): Promise<SummaryCheckResult> {
  try {
    const p8 = await llm.json<P8Result>(buildP8Prompt({ transcript: SAMPLE_TRANSCRIPT }), {
      model: 'haiku', // 走 fast 档轻量 P8，与正式短语音总结同档
      task: 'CHECK_SUMMARY',
      system: GLOBAL_SYSTEM,
    });
    const sample = (p8.summary ?? '').trim();
    if (!sample) {
      return { ok: false, error: '总结成功但未产出摘要（summary 为空）' };
    }
    const keyPoints = (p8.key_points ?? []).map((s) => s.trim()).filter(Boolean);
    return { ok: true, sample, keyPoints };
  } catch (err) {
    return { ok: false, error: reason(err) };
  }
}

/**
 * 对**当前配置的 chat LLM 供应商**做自检：chat ping + json 总结实测。
 *
 * - 读 env 解析当前 provider/base/model（不需鉴权/DB）；
 * - 两项各自独立优雅降级：一项失败不影响另一项与整体返回；
 * - 缺 key 时两项都会带「未配置 <ENV>」原因（不抛、不崩）。
 *
 * @param llm 可注入自定义 LlmClient（测试用）；缺省 createAnthropicClient()（按 env 走当前 provider）。
 */
export async function runLlmCheck(llm: LlmClient = createAnthropicClient()): Promise<LlmCheckResult> {
  const cfg = resolveLlmProvider();
  const meta = {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    modelFast: cfg.models.fast,
    modelStrong: cfg.models.strong,
    jsonMode: resolveLlmJsonMode(),
    apiKeyEnv: cfg.apiKeyEnv,
    hasKey: !!cfg.apiKey,
  };

  // 两项串行（量 ping 延迟时不与总结争抢；且总成本可控）。各自内部已 try/catch，不会抛。
  const ping = await runPing(llm, cfg.models.fast);
  const summary = await runSummary(llm);

  return { ...meta, ping, summary };
}
