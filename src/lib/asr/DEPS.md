# `src/lib/asr` 依赖说明

Fun-ASR 录音文件转写模块（百炼 · 录音文件异步识别）。**纯 `fetch` 实现，无新增 npm 依赖。**

## 运行时依赖

- **无新增 npm 包**。仅用 Node/Web 标准 `fetch`、`URL`、`setTimeout`。
  （未引 `dashscope` / `alibabacloud-*` SDK；如未来要换 SDK，再在此登记并更新 `package.json`。）

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | 是 | — | 百炼 API Key，与 `llm.ts` / `embeddings.ts` 共用。缺失时 `transcribeAudioUrl` 抛 `AsrKeyMissingError`，调用入口应据此优雅降级（同现有 transcribe 的「待配置」风格）。 |
| `MEMORY_FUNASR_MODEL` | 否 | `fun-asr` | 录音文件识别模型名。可换成 `paraformer-v2` 等同类异步模型。 |
| `MEMORY_DASHSCOPE_HTTP_BASE` | 否 | 由下推导 | DashScope 原生 API 根域。**注意**：录音文件异步识别走原生 `…/api/v1` 路径，**不是** llm/embeddings 用的 `…/compatible-mode/v1` 兼容端点。 |
| `DASHSCOPE_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 与 llm/embeddings 共用的兼容端点。本模块仅从中取 `origin`（根域）来拼原生路径；若设了 `MEMORY_DASHSCOPE_HTTP_BASE` 则忽略此项。 |
| `MEMORY_FUNASR_POLL_INTERVAL_MS` | 否 | `3000` | 轮询间隔（毫秒）。 |
| `MEMORY_FUNASR_TIMEOUT_MS` | 否 | `300000`（5min） | 轮询总超时（毫秒），超时抛 `AsrTimeoutError`。 |

> `.env.example` 现有的 `OPENAI_API_KEY`（Whisper 用）在本模块**不需要**；接线阶段把 transcribe 切到 Fun-ASR 后，Whisper/`OPENAI_API_KEY` 可一并退役。

## 接口端点（参考）

- 提交：`POST {HTTP_BASE}/api/v1/services/audio/asr/transcription`，头 `X-DashScope-Async: enable`
- 轮询：`GET {HTTP_BASE}/api/v1/tasks/{task_id}`
- 取文本：`GET {transcription_url}`（任务 SUCCEEDED 后由轮询响应给出，指向结果 JSON 文件）

## 导出

`funasr.ts`：
- `transcribeAudioUrl(audioUrl: string, opts?: { language?, pollIntervalMs?, timeoutMs? }): Promise<{ text: string }>`
- `FUNASR_MODEL`、`TranscribeOpts`
- 错误类：`AsrKeyMissingError`、`AsrTranscribeError`、`AsrTimeoutError`
