/**
 * 多供应商配置中枢（Chat LLM / Embedding / Vision-OCR 各自独立可配）
 *
 * 设计目标：
 * - **默认全 DashScope，不填新 env 时行为像素级不变**（base_url / 模型名 / key env 与改造前完全一致）。
 * - 各 AI 能力（chat / embedding / vision）独立选 provider，互不影响。
 * - 走 OpenAI 兼容端点的 provider（DeepSeek / OpenAI / Moonshot / 智谱 / custom）零代码扩展：
 *   只换 base_url + key env + 模型名，请求/响应形态与 DashScope 兼容端点一致。
 * - 缺 key 时由各能力沿用既有错误（LlmKeyMissingError / EmbeddingKeyMissingError），
 *   调用入口走既有优雅降级；本模块不负责抛错，只负责「解析配置」。
 *
 * 兼容性约定（务必保持）：
 * - 既有 env 覆盖（MEMORY_QWEN_PLUS / MEMORY_QWEN_MAX / MEMORY_QWEN_VL / MEMORY_EMBEDDING_MODEL /
 *   DASHSCOPE_BASE_URL）在 DashScope provider 下继续生效，优先级高于预设默认。
 * - 不读 env 的缺省值与改造前逐字一致。
 */

// ============ Provider 标识 ============

/** Chat LLM 可选 provider（均走 OpenAI 兼容 /chat/completions） */
export type LlmProviderId =
  | 'dashscope'
  | 'deepseek'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'custom';

/** Embedding 可选 provider */
export type EmbeddingProviderId = 'dashscope' | 'openai' | 'custom';

/** Vision(OCR) 可选 provider */
export type VisionProviderId = 'dashscope' | 'openai' | 'custom';

// ============ 工具 ============

/** 读环境变量并去首尾空白；空串视为未设置。 */
function env(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** 链式取第一个有值的 env，最后回落到默认字面量。 */
function envChain(names: string[], fallback: string): string {
  for (const n of names) {
    const v = env(n);
    if (v !== undefined) return v;
  }
  return fallback;
}

/** 归一化 base_url：去掉结尾多余的斜杠（统一由各 URL 拼接处补 /chat/completions 等）。 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// ============ Chat LLM 配置 ============

/**
 * Chat LLM 解析后的配置（供 llm.ts 构造请求用）。
 * - tier 模型映射沿用 'haiku'(fast) / 'sonnet'(strong) 两档，对调用方与测试不可见地改变。
 */
export interface LlmProviderConfig {
  provider: LlmProviderId;
  /** OpenAI 兼容根端点，形如 https://api.deepseek.com/v1（已去尾斜杠） */
  baseUrl: string;
  /** /chat/completions 完整 URL */
  chatUrl: string;
  /** 该 provider 读取的 API Key env 名（用于缺 key 报错信息更友好） */
  apiKeyEnv: string;
  /** 已解析的 API Key（可能 undefined → 调用方抛 LlmKeyMissingError 并降级） */
  apiKey: string | undefined;
  /** tier → 实际模型名 */
  models: { fast: string; strong: string };
}

/** 各 Chat provider 的预设（base_url / key env / fast·strong 模型默认）。 */
interface LlmPreset {
  baseUrl: string;
  apiKeyEnv: string;
  fast: string;
  strong: string;
}

const LLM_PRESETS: Record<Exclude<LlmProviderId, 'custom'>, LlmPreset> = {
  // DashScope（通义千问 OpenAI 兼容端点）—— 默认，缺省值与改造前逐字一致。
  dashscope: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    fast: 'qwen-plus',
    strong: 'qwen-max',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    fast: 'deepseek-chat',
    strong: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    fast: 'gpt-4o-mini',
    strong: 'gpt-4o',
  },
  // Moonshot（Kimi）OpenAI 兼容端点。
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    fast: 'moonshot-v1-8k',
    strong: 'moonshot-v1-32k',
  },
  // 智谱 GLM（OpenAI 兼容端点）。
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    fast: 'glm-4-flash',
    strong: 'glm-4-plus',
  },
};

/**
 * JSON 输出模式（response_format:{type:'json_object'}）的策略，env `LLM_JSON_MODE`：
 * - 'auto'（默认）：json() 路径带 response_format；若因 response_format/参数类 400 失败，
 *   自动去掉 response_format 重试一次（prompt 已含「输出合法 JSON」指令，json() 外层还有解析重试兜底）。
 * - 'on'：强制带 response_format，**不回退**（用于确定供应商支持、想严格约束的场景）。
 * - 'off'：从不带 response_format，直接靠 prompt 让模型输出 JSON（用于已知不支持该参数的供应商）。
 *
 * 兼容性：不填 = 'auto'，对默认 DashScope 行为逐字不变（DashScope 支持 response_format，正常成功不触发回退）。
 */
export type LlmJsonMode = 'auto' | 'on' | 'off';

/** 解析 LLM_JSON_MODE（非法/空值回落 'auto'）。 */
export function resolveLlmJsonMode(): LlmJsonMode {
  const raw = (env('LLM_JSON_MODE') ?? 'auto').toLowerCase();
  switch (raw) {
    case 'auto':
    case 'on':
    case 'off':
      return raw;
    default:
      console.warn(`[providers] 未知 LLM_JSON_MODE=${raw}，回落 auto`);
      return 'auto';
  }
}

function readLlmProviderId(): LlmProviderId {
  const raw = (env('LLM_PROVIDER') ?? 'dashscope').toLowerCase();
  switch (raw) {
    case 'dashscope':
    case 'deepseek':
    case 'openai':
    case 'moonshot':
    case 'zhipu':
    case 'custom':
      return raw;
    default:
      // 非法值回落到 dashscope，保持「不填/填错都像默认」。
      console.warn(`[providers] 未知 LLM_PROVIDER=${raw}，回落 dashscope`);
      return 'dashscope';
  }
}

/**
 * 解析当前 Chat LLM 配置。
 *
 * 优先级（每个字段独立）：
 *   1. DashScope 专属覆盖（仅 dashscope provider 生效，保兼容）：
 *      base_url ← DASHSCOPE_BASE_URL；fast ← MEMORY_QWEN_PLUS/MEMORY_CLAUDE_HAIKU；
 *      strong ← MEMORY_QWEN_MAX/MEMORY_CLAUDE_SONNET。
 *   2. 通用覆盖（任意 provider 生效）：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL_FAST / LLM_MODEL_STRONG。
 *   3. provider 预设默认。
 *
 * 说明：通用覆盖（LLM_*）对所有 provider 都可用，custom 之外的预设也可用它微调单个字段。
 */
export function resolveLlmProvider(): LlmProviderConfig {
  const provider = readLlmProviderId();

  if (provider === 'custom') {
    // custom：完全由 LLM_* 决定；base/key 缺省给空（缺 key 时调用方降级）。
    const baseUrl = trimTrailingSlash(
      envChain(['LLM_BASE_URL'], 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    );
    return {
      provider,
      baseUrl,
      chatUrl: `${baseUrl}/chat/completions`,
      apiKeyEnv: 'LLM_API_KEY',
      apiKey: env('LLM_API_KEY'),
      models: {
        fast: envChain(['LLM_MODEL_FAST'], 'qwen-plus'),
        strong: envChain(['LLM_MODEL_STRONG'], 'qwen-max'),
      },
    };
  }

  const preset = LLM_PRESETS[provider];
  const isDashscope = provider === 'dashscope';

  // base_url：DashScope 保留 DASHSCOPE_BASE_URL 兼容；通用 LLM_BASE_URL 对所有 provider 生效。
  const baseUrl = trimTrailingSlash(
    isDashscope
      ? envChain(['LLM_BASE_URL', 'DASHSCOPE_BASE_URL'], preset.baseUrl)
      : envChain(['LLM_BASE_URL'], preset.baseUrl)
  );

  // 模型：DashScope 保留 MEMORY_QWEN_* / MEMORY_CLAUDE_* 兼容（优先级最高，逐字保旧行为）。
  const fast = isDashscope
    ? envChain(['MEMORY_QWEN_PLUS', 'MEMORY_CLAUDE_HAIKU', 'LLM_MODEL_FAST'], preset.fast)
    : envChain(['LLM_MODEL_FAST'], preset.fast);
  const strong = isDashscope
    ? envChain(['MEMORY_QWEN_MAX', 'MEMORY_CLAUDE_SONNET', 'LLM_MODEL_STRONG'], preset.strong)
    : envChain(['LLM_MODEL_STRONG'], preset.strong);

  // key：优先 provider 专属 env；通用 LLM_API_KEY 作兜底（方便所有 provider 统一用一个变量）。
  const apiKey = env(preset.apiKeyEnv) ?? env('LLM_API_KEY');

  return {
    provider,
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    apiKeyEnv: preset.apiKeyEnv,
    apiKey,
    models: { fast, strong },
  };
}

// ============ Embedding 配置 ============

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderId;
  baseUrl: string;
  /** /embeddings 完整 URL */
  embeddingsUrl: string;
  apiKeyEnv: string;
  apiKey: string | undefined;
  model: string;
  /** 是否在请求体里带 dimensions（DashScope v4 / OpenAI v3 均支持，固定 1536 对齐 pgvector 列）。 */
  sendDimensions: boolean;
}

function readEmbeddingProviderId(): EmbeddingProviderId {
  const raw = (env('EMBEDDING_PROVIDER') ?? 'dashscope').toLowerCase();
  switch (raw) {
    case 'dashscope':
    case 'openai':
    case 'custom':
      return raw;
    default:
      console.warn(`[providers] 未知 EMBEDDING_PROVIDER=${raw}，回落 dashscope`);
      return 'dashscope';
  }
}

/**
 * 解析 Embedding 配置。维度恒为 1536（对齐 concepts.embedding vector(1536)，无迁移）。
 *
 * DashScope（默认）：base/key/model 与改造前逐字一致（DASHSCOPE_BASE_URL / DASHSCOPE_API_KEY /
 * MEMORY_EMBEDDING_MODEL → text-embedding-v4），发送 dimensions=1536。
 * OpenAI：text-embedding-3-small，**指定 dim=1536** 兼容现有列。
 */
export function resolveEmbeddingProvider(): EmbeddingProviderConfig {
  const provider = readEmbeddingProviderId();

  if (provider === 'openai') {
    const baseUrl = trimTrailingSlash(
      envChain(['EMBEDDING_BASE_URL'], 'https://api.openai.com/v1')
    );
    return {
      provider,
      baseUrl,
      embeddingsUrl: `${baseUrl}/embeddings`,
      apiKeyEnv: 'EMBEDDING_API_KEY/OPENAI_API_KEY',
      apiKey: env('EMBEDDING_API_KEY') ?? env('OPENAI_API_KEY'),
      model: envChain(['EMBEDDING_MODEL'], 'text-embedding-3-small'),
      sendDimensions: true, // OpenAI v3 支持 dimensions，固定 1536 对齐 pgvector 列。
    };
  }

  if (provider === 'custom') {
    const baseUrl = trimTrailingSlash(
      envChain(
        ['EMBEDDING_BASE_URL'],
        'https://dashscope.aliyuncs.com/compatible-mode/v1'
      )
    );
    return {
      provider,
      baseUrl,
      embeddingsUrl: `${baseUrl}/embeddings`,
      apiKeyEnv: 'EMBEDDING_API_KEY',
      apiKey: env('EMBEDDING_API_KEY'),
      model: envChain(['EMBEDDING_MODEL'], 'text-embedding-v4'),
      sendDimensions: true,
    };
  }

  // dashscope（默认）—— 逐字保旧行为。
  // 注意：MEMORY_EMBEDDING_MODEL 为改造前既有覆盖名，须保留为最高优先级。
  const baseUrl = trimTrailingSlash(
    envChain(
      ['EMBEDDING_BASE_URL', 'DASHSCOPE_BASE_URL'],
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    )
  );
  return {
    provider,
    baseUrl,
    embeddingsUrl: `${baseUrl}/embeddings`,
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    apiKey: env('DASHSCOPE_API_KEY') ?? env('EMBEDDING_API_KEY'),
    model: envChain(['MEMORY_EMBEDDING_MODEL', 'EMBEDDING_MODEL'], 'text-embedding-v4'),
    sendDimensions: true,
  };
}

// ============ Vision(OCR) 配置 ============

export interface VisionProviderConfig {
  provider: VisionProviderId;
  baseUrl: string;
  /** /chat/completions 完整 URL（视觉走图文混排 chat 消息） */
  chatUrl: string;
  apiKeyEnv: string;
  apiKey: string | undefined;
  model: string;
}

function readVisionProviderId(): VisionProviderId {
  const raw = (env('VISION_PROVIDER') ?? 'dashscope').toLowerCase();
  switch (raw) {
    case 'dashscope':
    case 'openai':
    case 'custom':
      return raw;
    default:
      console.warn(`[providers] 未知 VISION_PROVIDER=${raw}，回落 dashscope`);
      return 'dashscope';
  }
}

/**
 * 解析 Vision(OCR) 配置。
 *
 * DashScope（默认）：qwen-vl-plus（MEMORY_QWEN_VL 可覆盖），走 DASHSCOPE_BASE_URL 兼容端点 —— 逐字保旧行为。
 * OpenAI：gpt-4o（vision）。
 * 注：DeepSeek 无 vision；若把 LLM_PROVIDER 设为 deepseek 但未单独配 VISION_*，
 *     OCR 仍默认走 DashScope；若 DashScope key 也缺，则由 ocrImageUrl 抛 LlmKeyMissingError → 调用入口优雅降级。
 */
export function resolveVisionProvider(): VisionProviderConfig {
  const provider = readVisionProviderId();

  if (provider === 'openai') {
    const baseUrl = trimTrailingSlash(envChain(['VISION_BASE_URL'], 'https://api.openai.com/v1'));
    return {
      provider,
      baseUrl,
      chatUrl: `${baseUrl}/chat/completions`,
      apiKeyEnv: 'VISION_API_KEY/OPENAI_API_KEY',
      apiKey: env('VISION_API_KEY') ?? env('OPENAI_API_KEY'),
      model: envChain(['VISION_MODEL'], 'gpt-4o'),
    };
  }

  if (provider === 'custom') {
    const baseUrl = trimTrailingSlash(
      envChain(['VISION_BASE_URL'], 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    );
    return {
      provider,
      baseUrl,
      chatUrl: `${baseUrl}/chat/completions`,
      apiKeyEnv: 'VISION_API_KEY',
      apiKey: env('VISION_API_KEY'),
      model: envChain(['VISION_MODEL'], 'qwen-vl-plus'),
    };
  }

  // dashscope（默认）—— 逐字保旧行为（MEMORY_QWEN_VL 为既有覆盖名）。
  const baseUrl = trimTrailingSlash(
    envChain(['VISION_BASE_URL', 'DASHSCOPE_BASE_URL'], 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  );
  return {
    provider,
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    apiKey: env('DASHSCOPE_API_KEY') ?? env('VISION_API_KEY'),
    model: envChain(['MEMORY_QWEN_VL', 'VISION_MODEL'], 'qwen-vl-plus'),
  };
}
