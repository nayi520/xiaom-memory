/**
 * LLM json 模式自动回退 单测（不调真实 API，mock 全局 fetch）
 *
 * 运行：pnpm test:llm   （= tsx scripts/test-llm.ts）
 *
 * 覆盖（src/lib/llm.ts 的 json 模式自动回退 + LLM_JSON_MODE 开关 + 触发判定）：
 * 1. isResponseFormatUnsupported：400 + response_format/参数类关键字 → true；非 400 / 无关键字 → false
 * 2. LLM_JSON_MODE=auto（默认）+ jsonMode：首次带 response_format 报 400（response_format 类）→ 自动去掉重试成功
 * 3. 回退后请求体确实不再带 response_format（首次带、二次不带）
 * 4. 非 response_format 类 400（如内容错误）→ 不回退，照常抛（走既有降级）
 * 5. 非 400（如 500）→ 不回退，照常抛
 * 6. 非 jsonMode（text() 路径）→ 永不带 response_format、永不回退
 * 7. LLM_JSON_MODE=on：带 response_format，但 response_format 类 400 也**不回退**（直接抛）
 * 8. LLM_JSON_MODE=off：从不带 response_format（直接靠 prompt）
 * 9. 正常成功路径：jsonMode 带 response_format、一次成功、不重试（默认 DashScope 行为不变）
 */

// 必须在 import llm 之前设好 env（provider/key），让 complete 能走到 fetch。
process.env.LLM_PROVIDER = 'zhipu';
process.env.ZHIPU_API_KEY = 'test-key';
delete process.env.LLM_JSON_MODE; // 默认 auto

import {
  createAnthropicClient,
  isResponseFormatUnsupported,
  LlmHttpError,
} from '../src/lib/llm';

let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

// ============ fetch mock 脚手架 ============

interface Captured {
  body: Record<string, unknown>;
}
type Responder = (call: number, body: Record<string, unknown>) => {
  ok: boolean;
  status: number;
  text: string;
};

const realFetch = globalThis.fetch;
let captured: Captured[] = [];

/** 安装一个按「第几次调用」决定响应的 mock fetch；返回捕获到的请求列表。 */
function installFetch(responder: Responder): Captured[] {
  captured = [];
  let n = 0;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    captured.push({ body });
    n += 1;
    const r = responder(n, body);
    return {
      ok: r.ok,
      status: r.status,
      // 成功时回一个合法 OpenAI 兼容响应；失败时 text() 给错误体。
      text: async () => r.text,
      json: async () => ({
        choices: [{ message: { content: r.text } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  return captured;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** 一段合法 JSON 文本（作为「成功」响应内容）。 */
const OK_JSON = JSON.stringify({ summary: 's', key_points: [], todos: [], entities: [] });
/** 模拟某些 GLM 模型不支持 response_format 的 400 报错体。 */
const RF_400_BODY =
  '{"error":{"message":"response_format is not supported for this model","type":"invalid_request_error"}}';
/** 一个与 response_format 无关的 400（如内容/越权），不应触发回退。 */
const CONTENT_400_BODY = '{"error":{"message":"content policy violation"}}';

const NOISY_SILENCED = silenceConsole();

// ---- 1. isResponseFormatUnsupported ----
console.log('1. isResponseFormatUnsupported 触发判定');
{
  assert(isResponseFormatUnsupported(400, RF_400_BODY) === true, '400 + response_format → true');
  assert(
    isResponseFormatUnsupported(400, '{"error":"unsupported parameter: response_format"}') === true,
    '400 + unsupported parameter → true'
  );
  assert(
    isResponseFormatUnsupported(400, '{"error":"该模型不支持 json_object"}') === true,
    '400 + 中文「不支持」/json_object → true'
  );
  assert(isResponseFormatUnsupported(400, CONTENT_400_BODY) === false, '400 但内容类报错 → false');
  assert(isResponseFormatUnsupported(500, RF_400_BODY) === false, '非 400（500）→ false 即便含关键字');
  assert(isResponseFormatUnsupported(429, '') === false, '429 → false');
}

async function run() {
  // ---- 2 & 3. auto + jsonMode：response_format 类 400 → 自动去掉重试成功 ----
  console.log('2/3. auto + jsonMode：response_format 400 → 去掉 response_format 重试成功');
  {
    delete process.env.LLM_JSON_MODE; // auto
    const cap = installFetch((call) =>
      call === 1
        ? { ok: false, status: 400, text: RF_400_BODY } // 首次：带 response_format 报 400
        : { ok: true, status: 200, text: OK_JSON } // 二次：去掉后成功
    );
    const llm = createAnthropicClient({ logUsage: () => {} });
    let ok = false;
    try {
      const r = await llm.json<{ summary: string }>('prompt 含 JSON', { model: 'haiku', task: 'T' });
      ok = r.summary === 's';
    } catch {
      ok = false;
    }
    restoreFetch();
    assert(ok, '回退后 json() 成功解析');
    assert(cap.length === 2, '恰好两次请求（首次 + 回退一次）', `实际 ${cap.length}`);
    assert(
      cap[0]?.body.response_format != null,
      '首次请求带 response_format',
      JSON.stringify(cap[0]?.body.response_format)
    );
    assert(
      cap[1]?.body.response_format === undefined,
      '回退请求不带 response_format',
      JSON.stringify(cap[1]?.body.response_format)
    );
  }

  // ---- 4. 非 response_format 类 400 → 不回退，照常抛 ----
  console.log('4. 内容类 400（非 response_format）→ 不回退、照常抛');
  {
    delete process.env.LLM_JSON_MODE;
    const cap = installFetch(() => ({ ok: false, status: 400, text: CONTENT_400_BODY }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    let threw = false;
    try {
      await llm.json('prompt JSON', { model: 'haiku', task: 'T' });
    } catch (err) {
      threw = err instanceof LlmHttpError && err.status === 400;
    }
    restoreFetch();
    assert(threw, '内容类 400 仍抛出 LlmHttpError');
    assert(cap.length === 1, '只请求一次（不回退）', `实际 ${cap.length}`);
  }

  // ---- 5. 非 400（500）→ 不回退，照常抛 ----
  console.log('5. 500 → 不回退、照常抛');
  {
    delete process.env.LLM_JSON_MODE;
    const cap = installFetch(() => ({ ok: false, status: 500, text: 'server error' }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    let threw = false;
    try {
      await llm.json('prompt JSON', { model: 'haiku', task: 'T' });
    } catch (err) {
      threw = err instanceof LlmHttpError && err.status === 500;
    }
    restoreFetch();
    assert(threw, '500 仍抛出 LlmHttpError');
    assert(cap.length === 1, '只请求一次（不回退）', `实际 ${cap.length}`);
  }

  // ---- 6. 非 jsonMode（text()）→ 永不带 response_format、永不回退 ----
  console.log('6. text() 路径：永不带 response_format');
  {
    delete process.env.LLM_JSON_MODE;
    const cap = installFetch(() => ({ ok: true, status: 200, text: '一段 Markdown' }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    const out = await llm.text('随便', { model: 'haiku', task: 'T' });
    restoreFetch();
    assert(out === '一段 Markdown', 'text() 正常返回');
    assert(cap[0]?.body.response_format === undefined, 'text() 请求体无 response_format');
  }
  // 6b. text() 即便 400 response_format 体也不回退（理论上不会带，但验证不误触发）。
  {
    delete process.env.LLM_JSON_MODE;
    const cap = installFetch(() => ({ ok: false, status: 400, text: RF_400_BODY }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    let threw = false;
    try {
      await llm.text('随便', { model: 'haiku', task: 'T' });
    } catch {
      threw = true;
    }
    restoreFetch();
    assert(threw, 'text() 遇 400 照常抛');
    assert(cap.length === 1, 'text() 不回退（只一次请求）', `实际 ${cap.length}`);
  }

  // ---- 7. LLM_JSON_MODE=on：带 response_format，response_format 400 也不回退 ----
  console.log('7. LLM_JSON_MODE=on：带 response_format 但不回退');
  {
    process.env.LLM_JSON_MODE = 'on';
    const cap = installFetch(() => ({ ok: false, status: 400, text: RF_400_BODY }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    let threw = false;
    try {
      await llm.json('prompt JSON', { model: 'haiku', task: 'T' });
    } catch (err) {
      threw = err instanceof LlmHttpError;
    }
    restoreFetch();
    assert(cap[0]?.body.response_format != null, 'on：首次带 response_format');
    assert(threw && cap.length === 1, 'on：不回退，直接抛（只一次请求）', `实际 ${cap.length}`);
    delete process.env.LLM_JSON_MODE;
  }

  // ---- 8. LLM_JSON_MODE=off：从不带 response_format ----
  console.log('8. LLM_JSON_MODE=off：从不带 response_format');
  {
    process.env.LLM_JSON_MODE = 'off';
    const cap = installFetch(() => ({ ok: true, status: 200, text: OK_JSON }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    const r = await llm.json<{ summary: string }>('prompt JSON', { model: 'haiku', task: 'T' });
    restoreFetch();
    assert(r.summary === 's', 'off：json() 仍靠 prompt 成功解析');
    assert(cap[0]?.body.response_format === undefined, 'off：请求体无 response_format');
    assert(cap.length === 1, 'off：一次成功无重试', `实际 ${cap.length}`);
    delete process.env.LLM_JSON_MODE;
  }

  // ---- 9. 正常成功路径（默认 auto）：带 response_format、一次成功、不重试 ----
  console.log('9. 默认成功路径：带 response_format、一次成功、不回退');
  {
    delete process.env.LLM_JSON_MODE;
    const cap = installFetch(() => ({ ok: true, status: 200, text: OK_JSON }));
    const llm = createAnthropicClient({ logUsage: () => {} });
    const r = await llm.json<{ summary: string }>('prompt JSON', { model: 'haiku', task: 'T' });
    restoreFetch();
    assert(r.summary === 's', '成功解析');
    assert(cap[0]?.body.response_format != null, '带 response_format');
    assert(cap.length === 1, '一次成功、无回退/重试', `实际 ${cap.length}`);
  }

  NOISY_SILENCED();

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项断言失败`);
    process.exit(1);
  }
  console.log('\n✅ LLM json 模式自动回退（触发判定 / auto 回退 / on 不回退 / off 不带 / text 不触发 / 成功路径不变）全部通过');
}

/** 静音被测路径里的 console.warn（回退提示）/ console.error，避免污染测试输出；返回还原函数。 */
function silenceConsole(): () => void {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  // 保留 assert 自己用的 console.error：assert 直接调用，我们这里只屏蔽被测代码内部的。
  // 简化处理：测试断言失败极少，且其用的是 console.error；为不丢失失败信息，这里**不**屏蔽 error。
  void error;
  return () => {
    console.warn = warn;
  };
}

run().catch((err) => {
  console.error('测试运行异常：', err);
  process.exit(1);
});
