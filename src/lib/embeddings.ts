/**
 * Embedding 封装（去 Supabase 改造：DashScope text-embedding-v4 · OpenAI 兼容接口）
 *
 * 维度仍为 1536（dimensions=1536），与 concepts.embedding vector(1536) 及向量索引对齐，
 * **无需回填/改库**。导出签名（embed / EmbedFn / EmbeddingKeyMissingError / EMBEDDING_DIM）保持不变，
 * 调用方（pipeline / library search）零改动。缺 DASHSCOPE_API_KEY 时抛 EmbeddingKeyMissingError，
 * 由调用方优雅降级（跳过语义检索 / 关联发现）。
 */

export const EMBEDDING_MODEL = process.env.MEMORY_EMBEDDING_MODEL ?? 'text-embedding-v4';
export const EMBEDDING_DIM = 1536;

/** DashScope OpenAI 兼容端点（与 llm.ts 同一 base_url） */
const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_EMBEDDINGS_URL = `${DASHSCOPE_BASE_URL}/embeddings`;

export class EmbeddingKeyMissingError extends Error {
  constructor() {
    super('未配置 DASHSCOPE_API_KEY，无法计算 embedding');
    this.name = 'EmbeddingKeyMissingError';
  }
}

export type EmbedFn = (text: string) => Promise<number[]>;

export const embed: EmbedFn = async (text: string): Promise<number[]> => {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new EmbeddingKeyMissingError();

  const res = await fetch(DASHSCOPE_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // 防超长
      dimensions: EMBEDDING_DIM, // text-embedding-v4 支持指定维度 → 1536
      encoding_format: 'float',
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`DashScope embeddings ${res.status}：${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data: { embedding: number[] }[] };
  const vector = data.data?.[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIM) {
    throw new Error(`embedding 维度异常：${vector?.length ?? 0}（期望 ${EMBEDDING_DIM}）`);
  }
  return vector;
};
