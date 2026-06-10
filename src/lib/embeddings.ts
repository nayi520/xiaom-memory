/**
 * Embedding 封装：OpenAI text-embedding-3-small（1536 维，对应 concepts.embedding vector(1536)）
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

export class EmbeddingKeyMissingError extends Error {
  constructor() {
    super('未配置 OPENAI_API_KEY，无法计算 embedding');
    this.name = 'EmbeddingKeyMissingError';
  }
}

export type EmbedFn = (text: string) => Promise<number[]>;

export const embed: EmbedFn = async (text: string): Promise<number[]> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new EmbeddingKeyMissingError();

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // 防超长
      dimensions: EMBEDDING_DIM,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}：${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data: { embedding: number[] }[] };
  const vector = data.data?.[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIM) {
    throw new Error(`embedding 维度异常：${vector?.length ?? 0}（期望 ${EMBEDDING_DIM}）`);
  }
  return vector;
};
