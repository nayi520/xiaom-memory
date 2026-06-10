/**
 * 系统内置 AI 提示词（来源：03-系统内置AI提示词.md）
 *
 * P1 每日整理 / P2 制卡 / P3 关联确认 / P4 日报 / P7 语音清洗
 * 提示词正文【原样保留】，仅做 {{变量}} 注入，不要改写内容。
 */

/** 全局系统消息（03 文档「全局约定」） */
export const GLOBAL_SYSTEM =
  '输出必须是合法 JSON（或指定的 Markdown），不要输出任何解释性文字。所有内容使用简体中文。';

/** 简单模板注入：替换全部 {{name}} 占位符 */
function inject(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? vars[name] : `{{${name}}}`
  );
}

// ============ P1 每日整理（分类 + 标签 + 摘要 + 概念提炼） ============
// 模型建议：Haiku ｜ 触发：每晚批处理，逐条调用

const P1_TEMPLATE = `你是「小M」的知识整理助手。用户白天随手记录了一条内容，请帮他整理。

<用户现有类目体系>
{{domains_topics_json}}   // 如 {"心理学":["认知偏差","习惯养成"],"商业":["定价","增长"]}
</用户现有类目体系>

<用户历史修正示例>
{{correction_examples}}   // 最近 5 条用户修正过的整理结果，用于对齐口味
</用户历史修正示例>

<本条记录>
类型：{{type}}（文本/语音转写/文章剪藏/图片OCR）
内容：{{content}}
用户附注（为什么重要）：{{why_important}}
来源：{{url_or_source}}
</本条记录>

请输出 JSON：
{
  "domain": "一级领域（优先复用现有类目，确实不合适才新建）",
  "topic": "二级主题",
  "tags": ["3-6 个标签，名词短语，复用历史标签优先"],
  "summary": "≤100 字摘要，保留用户附注中体现的个人视角",
  "concepts": [
    {
      "name": "核心概念名（≤15 字）",
      "explanation": "用用户能看懂的话解释这个概念，150 字内，可包含记录中的例子"
    }
  ]
}

规则：
- 概念提炼 1-3 个，宁缺毋滥；纯情绪感想、待办事项类记录 concepts 可为空数组
- 摘要用中文，不复述废话，突出"用户当时为什么觉得重要"
- 不要编造记录中没有的信息`;

export interface P1Vars {
  domains_topics_json: string;
  correction_examples: string;
  type: string;
  content: string;
  why_important: string;
  url_or_source: string;
}

export interface P1Result {
  domain: string;
  topic: string;
  tags: string[];
  summary: string;
  concepts: { name: string; explanation: string }[];
}

export function buildP1Prompt(vars: P1Vars): string {
  return inject(P1_TEMPLATE, { ...vars });
}

// ============ P2 复习卡片生成 ============
// 模型建议：Haiku ｜ 触发：P1 产出每个概念后调用

const P2_TEMPLATE = `你是间隔重复学习专家。请为以下概念生成复习卡片。

<概念>
名称：{{concept_name}}
解释：{{concept_explanation}}
原始记录摘录：{{note_excerpt}}
用户附注：{{why_important}}
</概念>

请输出 JSON：
{
  "cards": [
    {"question": "...", "answer": "..."}
  ]
}

制卡原则（严格遵守）：
- 每概念 1-2 张，质量优先
- 问题必须能脱离原文独立理解，禁止"作者认为什么？"这类无上下文的问题
- 测试理解而非死记：优先"为什么/如何/举例说明/它和 X 的区别"，而非名词背诵
- 答案 ≤80 字，先给核心答案，再补一句帮助回忆的钩子（如原文例子）
- 如果概念太琐碎不值得复习，返回 {"cards": []}`;

export interface P2Vars {
  concept_name: string;
  concept_explanation: string;
  note_excerpt: string;
  why_important: string;
}

export interface P2Result {
  cards: { question: string; answer: string }[];
}

export function buildP2Prompt(vars: P2Vars): string {
  return inject(P2_TEMPLATE, { ...vars });
}

// ============ P3 关联发现 ============
// 模型建议：Sonnet ｜ 触发：embedding 检索出相似度 > 阈值的历史概念后确认

const P3_TEMPLATE = `你是知识网络分析师。判断以下两个概念之间是否存在值得告诉用户的关联。

<新概念>
{{new_concept_name}}：{{new_concept_explanation}}
（记录于 {{new_date}}）
</新概念>

<历史概念候选>
{{old_concept_name}}：{{old_concept_explanation}}
（记录于 {{old_date}}，来自《{{old_source}}》）
</历史概念候选>

输出 JSON：
{
  "related": true/false,
  "relation_type": "互补/印证/矛盾/同主题/因果/类比",
  "reason": "一句话说明关联，以用户视角写，如：这和你 3 月记的「损失厌恶」是同一现象的两面"
}

规则：仅当关联有启发性时 related=true。"都属于心理学"这种表面分类关系不算关联。
矛盾关系尤其有价值，要指出。`;

export interface P3Vars {
  new_concept_name: string;
  new_concept_explanation: string;
  new_date: string;
  old_concept_name: string;
  old_concept_explanation: string;
  old_date: string;
  old_source: string;
}

export interface P3Result {
  related: boolean;
  relation_type: string;
  reason: string;
}

export function buildP3Prompt(vars: P3Vars): string {
  return inject(P3_TEMPLATE, { ...vars });
}

// ============ P4 每日简报 ============
// 模型建议：Haiku ｜ 触发：每晚整理流水线结束后 ｜ 输出 Markdown（非 JSON）

const P4_TEMPLATE = `为用户生成今日知识简报，将随明早复习推送一起展示。

<今日数据>
新记录：{{today_notes_json}}
提炼的新概念：{{new_concepts_json}}
发现的关联：{{new_links_json}}
</今日数据>

输出 Markdown，≤200 字，结构：
- 一句话总结今天的记录主题
- 新概念列表（名称 + 一句话）
- 如有关联发现，用"💡 你可能没注意到："引出

语气：像一位安静的图书管理员，不夸张、不灌鸡汤。`;

export interface P4Vars {
  today_notes_json: string;
  new_concepts_json: string;
  new_links_json: string;
}

export function buildP4Prompt(vars: P4Vars): string {
  return inject(P4_TEMPLATE, { ...vars });
}

// ============ P7 语音转写后清洗 ============
// 模型建议：Haiku ｜ 触发：Whisper 转写之后、P1 之前 ｜ 输出纯文本

const P7_TEMPLATE = `以下是语音速记的自动转写，可能有口语赘词、错别字、标点缺失。
请清洗为通顺书面文本：去除"嗯、啊、就是说"等赘词，修正同音错字，分段。
不得增删实质内容，不确定的词保留原样并加[?]。

<转写原文>
{{raw_transcript}}
</转写原文>

直接输出清洗后文本。`;

export function buildP7Prompt(vars: { raw_transcript: string }): string {
  return inject(P7_TEMPLATE, { ...vars });
}
