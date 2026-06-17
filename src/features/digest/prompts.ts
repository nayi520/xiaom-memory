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

// ============ G1 概念 AI 出题（V16，按需多张）============
// 模型建议：Haiku（qwen-plus）｜ 触发：用户在概念详情点「AI 出题」，据概念 summary + 关联记录批量出题
// 与 P2 区别：P2 是流水线建概念后自动 1-2 张；G1 是用户按需指定张数、可参考更多关联记录。

const GEN_CARDS_TEMPLATE = `你是间隔重复学习专家。请基于用户知识库里的一个概念，生成 {{count}} 张高质量复习卡片。

<概念>
名称：{{concept_name}}
解释：{{concept_explanation}}
</概念>

<该概念的相关记录摘录>
{{notes_excerpt}}   // 用户记录中与该概念相关的片段，可能为空；据此让题目更贴合用户语境
</该概念的相关记录摘录>

请输出 JSON：
{
  "cards": [
    {"question": "...", "answer": "..."}
  ]
}

制卡原则（严格遵守）：
- 生成恰好 {{count}} 张（若概念实在太单薄、凑不满也不要硬编，宁可少出，但尽量满足张数）。
- 每张测试不同角度，避免重复；问题之间不要高度相似。
- 问题必须能脱离原文独立理解，禁止"作者认为什么？""这段讲了什么？"这类无上下文的问题。
- 测试理解而非死记：优先"为什么/如何/举例说明/它和 X 的区别/在什么情况下适用"，而非名词背诵。
- 答案 ≤80 字，先给核心答案，再补一句帮助回忆的钩子（如记录里的例子）。
- 只依据上面的概念与相关记录，不要编造记录中没有的信息。`;

export interface GenCardsVars {
  concept_name: string;
  concept_explanation: string;
  notes_excerpt: string;
  /** 期望生成张数（字符串注入）。 */
  count: string;
}

export interface GenCardsResult {
  cards: { question: string; answer: string }[];
}

export function buildGenCardsPrompt(vars: GenCardsVars): string {
  return inject(GEN_CARDS_TEMPLATE, { ...vars });
}

// ============ G2 学习指南 / 领域总结（V16）============
// 模型建议：Haiku（qwen-plus）｜ 触发：用户在知识库领域视图点「生成学习指南」｜ 输出 Markdown（非 JSON）

const STUDY_GUIDE_TEMPLATE = `你是一位善于建构知识体系的学习导师。请基于用户知识库里**他自己记录并由 AI 整理出的一组概念**，生成一份结构化的「学习指南」。

<范围>
{{scope_label}}   // 如「领域：心理学」或「选定的若干概念」
</范围>

<这些概念>
{{concepts_block}}   // 形如「- 概念名：解释」的若干条；这是用户已经记过的内容
</这些概念>

输出一份 Markdown 学习指南，结构建议：
- 以「## 学习指南：{{scope_label}}」开头，用一段话概述这组概念共同勾勒出的知识脉络。
- 「### 知识地图」：把这些概念按内在逻辑（基础→进阶、或主题分簇）梳理成一个有条理的结构，指出它们之间的关系。
- 「### 建议的学习顺序」：给出一个由浅入深的复习/学习路径（有序列表），并说明为什么这样排。
- 「### 可以深入的方向」：基于当前概念，温和地点出 2-3 个值得进一步探索或容易被忽略的点（不强加任务）。

要求（严格遵守）：
- **只基于上面给出的概念组织**，可以做合理的串联与归纳，但不要凭空引入用户没记过的大量新知识或编造事实。
- 用简体中文，Markdown 格式，条理清晰、≤700 字。
- 语气像一位耐心的导师，客观、克制，不灌鸡汤、不夸张。
- 不要复述这些规则，不要输出「根据资料」之类的元话术开场白。`;

export interface StudyGuideVars {
  /** 范围标签，如「领域：心理学」或「选定的 8 个概念」。 */
  scope_label: string;
  /** 概念清单块（「- 名称：解释」逐行）。 */
  concepts_block: string;
}

export function buildStudyGuidePrompt(vars: StudyGuideVars): string {
  return inject(STUDY_GUIDE_TEMPLATE, { ...vars });
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

// ============ P5 每周知识周报 ============
// 模型建议：Haiku ｜ 触发：每周手动/定时汇总本周 daily digests + 新概念 ｜ 输出 Markdown（非 JSON）

const P5_TEMPLATE = `把用户本周的知识记录汇总成一份「本周知识周报」。

<本周范围>
{{week_label}}（{{week_start}} 至 {{week_end}}）
</本周范围>

<本周每日简报>
{{daily_digests_md}}   // 本周每天的日报 Markdown 拼接（可能不全 7 天，按实有天数）
</本周每日简报>

<本周新概念>
{{concepts_json}}   // 本周新增概念 [{name, domain, topic, explanation}]，可能为空数组
</本周新概念>

<本周发现的关联>
{{links_json}}   // 本周新增的概念关联 [{from, to, relation_type, reason}]，可能为空数组
</本周发现的关联>

<可操作建议的素材>
{{actionable_json}}   // { dueConcepts:[概念名...], domainsWithoutCards:[领域名...] }，可能字段为空数组
// dueConcepts：已到复习期、该复习的概念；domainsWithoutCards：有记录/概念但还没有复习卡片的领域
</可操作建议的素材>

输出 Markdown 周报，≤550 字，结构：
- 以「## 本周回顾」开头，一段话总结本周关注的主题与脉络
- 「### 关键概念」：本周值得记住的概念列表（名称 + 一句话），按重要性挑 3-8 个，宁缺毋滥
- 如有跨概念关联，用「### 串联起来」小节，以用户视角点出「你这周的 A 和 B 其实……」
- 「### 可操作建议」：基于「可操作建议的素材」，给出 2-4 条**具体、可立即执行**的建议，用无序列表。例如：
  · 若 dueConcepts 非空：提醒「这些概念该复习了：A、B、C」（最多列 5 个，多则以「等」收尾）
  · 若 domainsWithoutCards 非空：提醒「『X』领域记了不少但还没有复习卡片，可以去给关键概念建几张卡 / 用 AI 出题」
  · 素材都为空时，这一节可省略或只给一句温和的延伸方向，不要硬凑、不要编造数据里没有的概念/领域名
- 结尾「### 下周可留意」：基于本周脉络给一句温和的延伸建议（不强加任务）

语气：像一位安静的图书管理员，客观、克制，不灌鸡汤、不夸张。
建议要落到具体的概念名/领域名上（只用素材里出现过的名字），不要泛泛而谈。
如果本周几乎没有内容，就如实写一句「这周记录不多」，不要硬凑。`;

export interface P5Vars {
  week_label: string;
  week_start: string;
  week_end: string;
  daily_digests_md: string;
  concepts_json: string;
  links_json: string;
  /**
   * 可操作建议素材 JSON（V16，可选，向后兼容）：
   * { dueConcepts: string[], domainsWithoutCards: string[] }。缺省注入空素材。
   */
  actionable_json?: string;
}

export function buildP5Prompt(vars: P5Vars): string {
  return inject(P5_TEMPLATE, {
    ...vars,
    actionable_json:
      vars.actionable_json ?? '{"dueConcepts":[],"domainsWithoutCards":[]}',
  });
}

// ============ P6 知识库问答（RAG，基于检索作答） ============
// 模型建议：Sonnet ｜ 触发：用户在问答页提问，先 embedding 召回 top-K 概念 ｜ 输出 Markdown（非 JSON）

const P6_TEMPLATE = `你是「小M」的知识库问答助手。用户向自己的个人知识库提了一个问题。
请**只依据下面检索到的资料**作答，资料来自用户自己过去记录、并由 AI 整理出的概念。
{{history_block}}
<用户的问题>
{{question}}
</用户的问题>

<检索到的资料>
{{context}}   // 形如「[1] 概念名：解释（相关记录摘要）」的若干条，按相关度排序；可能为空
</检索到的资料>

作答要求（严格遵守）：
- **只用上面的资料作答，不得使用资料之外的常识或编造**。资料能回答到什么程度，就答到什么程度。
- 在引用具体内容处用 [1] [2] 这样的角标标出来源，对应资料编号。
- 如果检索资料为空，或资料与问题无关、不足以回答，就**直接说明「你的知识库里暂时没有相关记录」**，可顺带建议用户去记录相关内容，**不要编造答案，也不要泛泛而谈**。
- 若有「最近对话」，仅用它理解本轮问题的指代/上下文（如「它」「这个」指什么），作答依据仍**只能**是上面的资料。
- 用简体中文，Markdown 格式，简洁清晰；不要复述这些规则，不要输出「根据资料」之类的元话术开场白。`;

/** 多轮对话上下文：拼成「最近对话」区块（限制轮数/长度在调用方处理） */
export interface P6Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface P6Vars {
  question: string;
  context: string;
  /** 最近对话（可选），按时间顺序，已由调用方截断轮数/长度 */
  history?: P6Turn[];
}

function buildHistoryBlock(history?: P6Turn[]): string {
  if (!history || history.length === 0) return '';
  const lines = history
    .map((t) => `${t.role === 'user' ? '用户' : '小M'}：${t.content}`)
    .join('\n');
  return `\n<最近对话>\n${lines}\n</最近对话>\n`;
}

export function buildP6Prompt(vars: P6Vars): string {
  return inject(P6_TEMPLATE, {
    question: vars.question,
    context: vars.context,
    history_block: buildHistoryBlock(vars.history),
  });
}

// ============ P6R 问答检索重排序（V16 RAG 重排）============
// 模型建议：Haiku（qwen-plus，比作答的 sonnet 便宜）｜ 触发：召回较多候选后、作答前
// 让模型只做「挑选 + 排序」（不作答），从候选里选出与问题最相关的若干条编号，提升上下文质量。
// 不改对外契约：仅影响最终拼进上下文/来源的概念子集与顺序。

const RERANK_TEMPLATE = `你是知识检索重排序器。下面是用户的问题，以及从其个人知识库里召回的若干「候选概念」（已编号）。
请只判断**哪些候选最有助于回答这个问题**，并按相关度从高到低排序，挑出最相关的最多 {{top_n}} 个。

<问题>
{{question}}
</问题>

<候选概念>
{{candidates}}   // 形如「[1] 概念名：解释」的若干条
</候选概念>

只输出 JSON（不要任何解释文字）：
{ "ranked": [候选编号, ...] }   // 按相关度降序的编号数组，最多 {{top_n}} 个；与问题都不相关时返回 {"ranked": []}

规则：
- 只能引用上面出现过的编号，不要编造编号。
- 宁缺毋滥：明显跑题的候选不要选入。
- 不要作答，只做挑选与排序。`;

export interface RerankVars {
  question: string;
  candidates: string;
  /** 期望选出的最大条数（字符串注入）。 */
  top_n: string;
}

export interface RerankResult {
  ranked: number[];
}

export function buildRerankPrompt(vars: RerankVars): string {
  return inject(RERANK_TEMPLATE, { ...vars });
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
