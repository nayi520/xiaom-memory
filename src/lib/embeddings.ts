/**
 * Embedding 封装（多供应商：DashScope text-embedding-v4 / OpenAI text-embedding-3-small · OpenAI 兼容接口）
 *
 * provider 由 env `EMBEDDING_PROVIDER` 决定（默认 dashscope；见 src/lib/providers.ts）。
 * 维度恒为 1536（dimensions=1536），与 concepts.embedding vector(1536) 及向量索引对齐，**无需回填/改库**。
 * 导出签名（embed / EmbedFn / EmbeddingKeyMissingError / EMBEDDING_DIM / EMBEDDING_MODEL）保持不变，
 * 调用方（pipeline / library search）零改动。缺当前 provider 的 key 时抛 EmbeddingKeyMissingError，
 * 由调用方优雅降级（跳过语义检索 / 关联发现）。
 *
 * **默认 DashScope 行为像素级不变**：不填新 env 时 base_url / 模型（text-embedding-v4）/ key（DASHSCOPE_API_KEY）
 * 与改造前逐字一致；既有覆盖 MEMORY_EMBEDDING_MODEL / DASHSCOPE_BASE_URL 继续生效。
 * OpenAI（EMBEDDING_PROVIDER=openai）：text-embedding-3-small，**指定 dim=1536** 兼容现有 pgvector 列。
 */

import { resolveEmbeddingProvider } from './providers';

export const EMBEDDING_DIM = 1536;

/**
 * 当前 provider 的 embedding 模型名（对外快照，加载时解析）。
 * 默认 DashScope text-embedding-v4；EMBEDDING_PROVIDER=openai 时为 text-embedding-3-small。
 * 实际请求每次取最新 resolveEmbeddingProvider()，以便运行时改 env 即时生效。
 */
export const EMBEDDING_MODEL = resolveEmbeddingProvider().model;

export class EmbeddingKeyMissingError extends Error {
  constructor(key = 'DASHSCOPE_API_KEY') {
    super(`未配置 ${key}，无法计算 embedding`);
    this.name = 'EmbeddingKeyMissingError';
  }
}

export type EmbedFn = (text: string) => Promise<number[]>;

export const embed: EmbedFn = async (text: string): Promise<number[]> => {
  const cfg = resolveEmbeddingProvider();
  if (!cfg.apiKey) throw new EmbeddingKeyMissingError(cfg.apiKeyEnv);

  const body: Record<string, unknown> = {
    model: cfg.model,
    input: text.slice(0, 8000), // 防超长
    encoding_format: 'float',
  };
  // DashScope text-embedding-v4 / OpenAI text-embedding-3-* 均支持指定维度 → 固定 1536 对齐 pgvector 列。
  if (cfg.sendDimensions) body.dimensions = EMBEDDING_DIM;

  const res = await fetch(cfg.embeddingsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`embeddings(${cfg.provider}) ${res.status}：${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data: { embedding: number[] }[] };
  const vector = data.data?.[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIM) {
    throw new Error(`embedding 维度异常：${vector?.length ?? 0}（期望 ${EMBEDDING_DIM}）`);
  }
  return vector;
};
