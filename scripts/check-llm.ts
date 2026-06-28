/**
 * AI 供应商自检（dev 脚本）—— 命令行实测当前配置的 chat LLM 供应商。
 *
 * 运行：pnpm check:llm   （= tsx scripts/check-llm.ts）
 *
 * 读 env（自动加载 .env.local / .env，若存在）→ 打印 provider / base / 两档模型 / JSON 模式 / key 状态，
 * 然后真打两项调用并打印结果：
 *   (a) chat ping：通不通 + 延迟 ms + 实际模型名（失败给原因）；
 *   (b) json 总结实测：用固定示例转写跑 P8，打印示例摘要 + 关键要点（失败给原因）。
 *
 * 用途：把文本 AI 切到智谱 GLM / Kimi(moonshot) 后，在本机一键验证 provider/key 是否通 + 看总结质量，
 *       无需起服务、无需登录。**会产生真实付费调用**（两次）。
 *
 * 与 /api/check-llm 复用同一核心（src/lib/llm-check.ts），结果一致。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runLlmCheck, SAMPLE_TRANSCRIPT } from '../src/lib/llm-check';

/**
 * 极简 .env 加载：把 KEY=VALUE 行注入 process.env（**不覆盖已存在的**，让 shell 显式设的优先）。
 * 仅供本 dev 脚本用（tsx 不像 next 那样自动读 .env.local）；忽略注释/空行，去掉值两侧引号。
 */
function loadEnvFile(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue; // 不覆盖已设的
    let value = line.slice(eq + 1).trim();
    // 去掉成对的首尾引号。
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  // 加载本地 env（.env.local 优先级高于 .env：先加载 .env.local 占位，.env 不覆盖）。
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  console.log('=== AI 供应商自检（pnpm check:llm）===\n');

  const result = await runLlmCheck();

  console.log(`provider   : ${result.provider}`);
  console.log(`baseUrl    : ${result.baseUrl}`);
  console.log(`modelFast  : ${result.modelFast}`);
  console.log(`modelStrong: ${result.modelStrong}`);
  console.log(`jsonMode   : ${result.jsonMode}（LLM_JSON_MODE）`);
  console.log(`apiKeyEnv  : ${result.apiKeyEnv} → ${result.hasKey ? '已配置' : '未配置（缺 key）'}`);
  console.log('');

  // (a) chat ping
  if (result.ping.ok) {
    console.log(`✅ chat ping：连接正常 · ${result.ping.ms}ms · 模型 ${result.ping.model}`);
  } else {
    console.log(`❌ chat ping：失败 — ${result.ping.error}`);
  }
  console.log('');

  // (b) json 总结实测
  console.log('— json 总结实测（固定示例转写）—');
  console.log(`示例转写：${SAMPLE_TRANSCRIPT}\n`);
  if (result.summary.ok) {
    console.log('✅ 示例总结成功：');
    console.log(`  摘要：${result.summary.sample}`);
    if (result.summary.keyPoints && result.summary.keyPoints.length > 0) {
      console.log('  关键要点：');
      for (const p of result.summary.keyPoints) console.log(`    - ${p}`);
    }
  } else {
    console.log(`❌ 示例总结失败 — ${result.summary.error}`);
  }
  console.log('');

  // 退出码：两项都通才算 0，便于 CI/脚本判定（缺 key 等会非 0）。
  const allOk = result.ping.ok && result.summary.ok;
  if (!allOk) {
    console.log('自检未全部通过（见上）。若是缺 key，请按 .env.example 配置当前 provider 的 API Key 后重试。');
    process.exit(1);
  }
  console.log('自检全部通过 ✅');
}

main().catch((err) => {
  console.error('自检脚本异常：', err);
  process.exit(1);
});
