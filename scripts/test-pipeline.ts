/**
 * 流水线数据流验证（不调真实 API）
 *
 * 运行：pnpm test:pipeline   （= tsx scripts/test-pipeline.ts）
 *
 * 覆盖：
 * 1. 语音记录先走 P7 清洗，清洗结果写回 raw_content
 * 2. P1 → 概念 / 标签 / 摘要落库，note 标记 processed
 * 3. P1 输出非 JSON 自动重试 1 次（成功路径）
 * 4. P1 重试后仍失败 → note 标记 needs_review，不阻塞其他记录
 * 5. P2 → 卡片落库，fsrs_state 初始 {stability:null,difficulty:null,reps:0,due:明天}
 * 6. embedding → match_concepts（排除本次新建概念）→ P3 确认 → concept_links
 * 7. P4 → digests(type='daily') 落库
 * 8. 单条 note 卡片封顶（MEMORY_MAX_CARDS_PER_NOTE，默认 3）：3 概念 × 每概念 2 卡 → 最终 ≤ 3，
 *    靠前概念优先保留、达上限后剩余概念跳过 P2
 */

import { buildLlmClient, type LlmCallOpts } from '../src/lib/llm';
import {
  runDigestForUser,
  runDigestForAllUsers,
  dayWindow,
  initialFsrsState,
  SIMILARITY_THRESHOLD,
  MATCH_LIMIT,
  type DigestStore,
  type MatchedConcept,
  type CorrectionRow,
} from '../src/features/digest/pipeline';
import type { Note } from '../src/lib/types';

// ============ 内存版 DigestStore ============

interface MemConcept {
  id: string;
  user_id: string;
  name: string;
  summary: string;
  domain: string;
  topic: string;
  embedding: number[] | null;
  created_at: string;
  source: string | null;
}

class MemoryStore implements DigestStore {
  notes = new Map<string, Note>();
  concepts = new Map<string, MemConcept>();
  noteConcepts: { note_id: string; concept_id: string }[] = [];
  cards: { concept_id: string; question: string; answer: string; fsrs_state: Record<string, unknown> }[] = [];
  tags = new Map<string, string>(); // name -> id
  noteTags: { note_id: string; tag_id: string }[] = [];
  links: { concept_a: string; concept_b: string; relation_type: string; reason: string }[] = [];
  digests: { user_id: string; type: string; period: string; content_md: string }[] = [];
  private seq = 0;

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  async listUserIdsWithInbox(fromIso: string, toIso: string) {
    const ids = new Set<string>();
    for (const n of Array.from(this.notes.values())) {
      if (n.status === 'inbox' && n.created_at >= fromIso && n.created_at < toIso) {
        ids.add(n.user_id);
      }
    }
    return Array.from(ids);
  }

  async listUserIdsWithInboxUpTo(toIso: string) {
    const ids = new Set<string>();
    for (const n of Array.from(this.notes.values())) {
      if (n.status === 'inbox' && n.created_at < toIso) {
        ids.add(n.user_id);
      }
    }
    return Array.from(ids);
  }

  async listInboxNotes(userId: string, fromIso: string, toIso: string) {
    return Array.from(this.notes.values())
      .filter(
        (n) =>
          n.user_id === userId &&
          n.status === 'inbox' &&
          n.created_at >= fromIso &&
          n.created_at < toIso
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async listAllInboxNotes(userId: string) {
    return Array.from(this.notes.values())
      .filter((n) => n.user_id === userId && n.status === 'inbox')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async getDomainsTopics(userId: string) {
    const map: Record<string, string[]> = {};
    for (const c of Array.from(this.concepts.values())) {
      if (c.user_id !== userId) continue;
      if (!map[c.domain]) map[c.domain] = [];
      if (!map[c.domain].includes(c.topic)) map[c.domain].push(c.topic);
    }
    return map;
  }

  async getRecentCorrections(): Promise<CorrectionRow[]> {
    return [
      { target_type: 'concept', field: 'domain', old_value: '商业', new_value: '心理学' },
    ];
  }

  async updateNote(noteId: string, patch: Partial<Note>) {
    const note = this.notes.get(noteId);
    if (!note) throw new Error(`note 不存在：${noteId}`);
    Object.assign(note, patch);
  }

  async insertConcept(
    userId: string,
    concept: { name: string; summary: string; domain: string; topic: string }
  ) {
    const id = this.nextId('concept');
    this.concepts.set(id, {
      id,
      user_id: userId,
      ...concept,
      embedding: null,
      created_at: new Date().toISOString(),
      source: null,
    });
    return id;
  }

  async setConceptEmbedding(conceptId: string, embedding: number[]) {
    const c = this.concepts.get(conceptId);
    if (!c) throw new Error(`concept 不存在：${conceptId}`);
    c.embedding = embedding;
  }

  async linkNoteConcept(noteId: string, conceptId: string) {
    this.noteConcepts.push({ note_id: noteId, concept_id: conceptId });
  }

  async insertCards(
    conceptId: string,
    cards: { question: string; answer: string }[],
    fsrsState: Record<string, unknown>
  ) {
    for (const c of cards) {
      this.cards.push({ concept_id: conceptId, ...c, fsrs_state: fsrsState });
    }
  }

  async ensureTags(userId: string, noteId: string, tags: string[]) {
    for (const name of tags) {
      let id = this.tags.get(name);
      if (!id) {
        id = this.nextId('tag');
        this.tags.set(name, id);
      }
      this.noteTags.push({ note_id: noteId, tag_id: id });
    }
  }

  async matchConcepts(
    userId: string,
    embedding: number[],
    threshold: number,
    limit: number,
    excludeIds: string[]
  ): Promise<MatchedConcept[]> {
    const cosine = (a: number[], b: number[]) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    };
    return Array.from(this.concepts.values())
      .filter(
        (c) =>
          c.user_id === userId &&
          c.embedding !== null &&
          !excludeIds.includes(c.id) &&
          cosine(c.embedding!, embedding) > threshold
      )
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        name: c.name,
        summary: c.summary,
        created_at: c.created_at,
        similarity: cosine(c.embedding!, embedding),
        source: c.source,
      }));
  }

  async insertConceptLink(a: string, b: string, relationType: string, reason: string) {
    this.links.push({ concept_a: a, concept_b: b, relation_type: relationType, reason });
  }

  async saveDailyDigest(userId: string, period: string, contentMd: string) {
    this.digests = this.digests.filter(
      (d) => !(d.user_id === userId && d.type === 'daily' && d.period === period)
    );
    this.digests.push({ user_id: userId, type: 'daily', period, content_md: contentMd });
  }
}

// ============ Mock LLM ============

const llmCalls: { task: string; model: string }[] = [];
let p1FirstCallDone = false;

async function mockComplete(prompt: string, opts: LlmCallOpts): Promise<string> {
  llmCalls.push({ task: opts.task, model: opts.model });

  switch (opts.task) {
    case 'P7':
      return '今天散步时想到，心流状态需要挑战与能力匹配。';

    case 'P1': {
      // 坏记录：始终输出非 JSON → 触发 needs_review
      if (prompt.includes('BAD_NOTE')) return '抱歉，我无法处理这条记录。';
      // 首次 P1 调用输出非 JSON，验证自动重试路径
      if (!p1FirstCallDone) {
        p1FirstCallDone = true;
        return '好的，我来整理（此输出故意不含 JSON，测试重试）。';
      }
      if (prompt.includes('心流')) {
        return JSON.stringify({
          domain: '心理学',
          topic: '专注力',
          tags: ['心流', '专注', '挑战匹配'],
          summary: '散步时对心流条件的随想：挑战与能力需匹配。',
          concepts: [
            { name: '心流', explanation: '全神贯注的最优体验状态，发生在挑战与能力匹配时。' },
          ],
        });
      }
      return JSON.stringify({
        domain: '心理学',
        topic: '认知偏差',
        tags: ['体验记忆', '峰终定律', '行为设计'],
        summary: '记录峰终定律：人对体验的记忆由峰值与结尾决定。',
        concepts: [
          { name: '峰终定律', explanation: '人评价一段体验主要看峰值时刻和结束时刻，而非平均值。' },
        ],
      });
    }

    case 'P2':
      return JSON.stringify({
        cards: [
          { question: '为什么排队体验的结尾比平均等待时间更影响评价？', answer: '峰终定律：记忆由峰值与结尾决定。' },
          { question: '举一个利用峰终定律改善体验的例子？', answer: '宜家出口的 1 元冰淇淋，用好结尾覆盖逛店疲劳。' },
        ],
      });

    case 'P3':
      // 只确认与「损失厌恶」的关联，其他判为不相关
      if (prompt.includes('损失厌恶')) {
        return JSON.stringify({
          related: true,
          relation_type: '互补',
          reason: '这和你之前记的「损失厌恶」都说明主观感受≠客观度量。',
        });
      }
      return JSON.stringify({ related: false, relation_type: '', reason: '' });

    case 'P4':
      return '# 今日简报\n\n今天记录围绕体验与注意力。\n- 峰终定律：记忆看峰值与结尾\n- 心流：挑战与能力匹配';

    default:
      throw new Error(`未知 task：${opts.task}`);
  }
}

// ============ 断言工具 ============

let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

// ============ 主流程 ============

async function main() {
  const userId = 'user-1';
  const store = new MemoryStore();
  const now = new Date();
  const window = dayWindow(now);
  const todayIso = now.toISOString();

  // 历史概念（昨天记的「损失厌恶」，已有 embedding）
  const histVec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0.001));
  store.concepts.set('concept-hist', {
    id: 'concept-hist',
    user_id: userId,
    name: '损失厌恶',
    summary: '损失带来的痛苦约为同等收益快乐的两倍。',
    domain: '心理学',
    topic: '认知偏差',
    embedding: histVec,
    created_at: '2026-06-01T08:00:00.000Z',
    source: '《思考，快与慢》',
  });

  // 当日 inbox 记录：文本 / 语音（带转写）/ 坏记录
  const seedNotes: Note[] = [
    {
      id: 'note-text',
      user_id: userId,
      type: 'text',
      raw_content: '峰终定律：人对体验的记忆由峰值和结尾决定',
      transcript: null,
      url: null,
      media_path: null,
      why_important: '可以用来设计产品体验',
      status: 'inbox',
      created_at: todayIso,
    },
    {
      id: 'note-voice',
      user_id: userId,
      type: 'voice',
      raw_content: '嗯就是说今天散步的时候啊想到心流状态嗯需要挑战与能力匹配',
      transcript: '嗯就是说今天散步的时候啊想到心流状态嗯需要挑战与能力匹配',
      url: null,
      media_path: 'user-1/a.webm',
      why_important: null,
      status: 'inbox',
      created_at: todayIso,
    },
    {
      id: 'note-bad',
      user_id: userId,
      type: 'text',
      raw_content: 'BAD_NOTE 这条会让 P1 始终输出非 JSON',
      transcript: null,
      url: null,
      media_path: null,
      why_important: null,
      status: 'inbox',
      created_at: todayIso,
    },
  ];
  for (const n of seedNotes) store.notes.set(n.id, n);

  // mock embed：与历史概念同向 → 相似度 ≈ 1 > 0.82
  const mockEmbed = async () => histVec.slice();

  const llm = buildLlmClient(mockComplete);
  const result = await runDigestForUser(userId, {
    store,
    llm,
    embed: mockEmbed,
    now,
    log: (m) => console.log(`  [pipeline] ${m}`),
  });

  console.log('\n— 结果断言 —');
  assert(result.notesTotal === 3, `取到 3 条当日 inbox（实际 ${result.notesTotal}）`);
  assert(result.notesProcessed === 2, `2 条处理成功（实际 ${result.notesProcessed}）`);
  assert(result.notesNeedsReview === 1, `1 条标记 needs_review（实际 ${result.notesNeedsReview}）`);
  assert(store.notes.get('note-text')!.status === 'processed', 'note-text → processed');
  assert(store.notes.get('note-voice')!.status === 'processed', 'note-voice → processed');
  assert(store.notes.get('note-bad')!.status === 'needs_review', 'note-bad → needs_review');

  console.log('\n— P7 语音清洗 —');
  assert(
    store.notes.get('note-voice')!.raw_content === '今天散步时想到，心流状态需要挑战与能力匹配。',
    'P7 清洗结果写回 raw_content'
  );
  assert(llmCalls.some((c) => c.task === 'P7' && c.model === 'haiku'), 'P7 用 haiku');

  console.log('\n— P1 整理与重试 —');
  const p1Calls = llmCalls.filter((c) => c.task === 'P1').length;
  // note-text 2 次（首次坏输出+重试）、note-voice 1 次、note-bad 2 次（重试后仍失败）
  assert(p1Calls === 5, `P1 调用 5 次：含 1 次成功重试 + 1 次失败重试（实际 ${p1Calls}）`);
  assert(store.notes.get('note-text')!.summary === '记录峰终定律：人对体验的记忆由峰值与结尾决定。', 'note 摘要落库');
  assert(store.tags.size === 6, `标签去重落库 6 个（实际 ${store.tags.size}）`);
  assert(
    store.noteTags.filter((t) => t.note_id === 'note-text').length === 3,
    'note-text 关联 3 个标签'
  );

  console.log('\n— 概念与卡片 —');
  assert(result.conceptsCreated === 2, `新建 2 个概念（实际 ${result.conceptsCreated}）`);
  assert(
    store.noteConcepts.length === 2,
    `note_concepts 关联 2 条（实际 ${store.noteConcepts.length}）`
  );
  assert(result.cardsCreated === 4, `4 张卡片（每概念 2 张，实际 ${result.cardsCreated}）`);
  const fsrs = store.cards[0]?.fsrs_state as { stability: unknown; difficulty: unknown; reps: number; due: string };
  assert(
    fsrs &&
      fsrs.stability === null &&
      fsrs.difficulty === null &&
      fsrs.reps === 0 &&
      fsrs.due === window.tomorrowIso,
    `fsrs_state 初始为 {stability:null,difficulty:null,reps:0,due:${window.tomorrowIso}}`
  );
  assert(
    JSON.stringify(initialFsrsState(window.tomorrowIso)) === JSON.stringify(fsrs),
    'fsrs_state 与 initialFsrsState 一致'
  );

  console.log('\n— Embedding 与关联发现 —');
  const newConceptIds = Array.from(store.concepts.values())
    .filter((c) => c.id !== 'concept-hist')
    .map((c) => c.id);
  assert(
    newConceptIds.every((id) => store.concepts.get(id)!.embedding !== null),
    '新概念均已写入 embedding'
  );
  const p3Calls = llmCalls.filter((c) => c.task === 'P3');
  // 每个新概念都与「损失厌恶」相似（同向量），且互相被排除 → 各 1 次 P3
  assert(p3Calls.length === 2, `P3 调用 2 次（排除了本次新建概念互相匹配，实际 ${p3Calls.length}）`);
  assert(p3Calls.every((c) => c.model === 'sonnet'), 'P3 用 sonnet');
  assert(result.linksCreated === 2, `2 条关联落库（均含损失厌恶，实际 ${result.linksCreated}）`);
  assert(
    store.links.every((l) => l.concept_b === 'concept-hist' && l.relation_type === '互补' && l.reason.length > 0),
    'concept_links 指向历史概念且含 relation_type/reason'
  );

  console.log('\n— P4 日报 —');
  assert(result.digestSaved, '日报已生成');
  const digest = store.digests[0];
  assert(
    !!digest && digest.type === 'daily' && digest.period === window.period,
    `digests(type='daily', period=${window.period})`
  );
  assert(!!digest && digest.content_md.includes('峰终定律'), '日报内容包含新概念');

  console.log('\n— 模型分配 —');
  assert(
    llmCalls
      .filter((c) => ['P1', 'P2', 'P4', 'P7'].includes(c.task))
      .every((c) => c.model === 'haiku'),
    'P1/P2/P4/P7 全部用 haiku'
  );

  // ============ scope='all'：往日积压补整理（搁置缺口修复验证） ============
  console.log('\n— scope=all：往日积压不再被永久搁置 —');
  {
    const store2 = new MemoryStore();
    // 一条「昨天」创建、至今仍 inbox 的旧记录（落在当天窗口之外）
    const oldIso = new Date(new Date(window.fromIso).getTime() - 12 * 3600 * 1000).toISOString();
    store2.notes.set('note-old', {
      id: 'note-old',
      user_id: userId,
      type: 'text',
      raw_content: '峰终定律：人对体验的记忆由峰值和结尾决定',
      transcript: null,
      url: null,
      media_path: null,
      why_important: null,
      status: 'inbox',
      created_at: oldIso,
    });

    // 默认 scope（today）：旧记录在窗口外 → 取不到（这正是「搁置」缺口）
    const todayRun = await runDigestForUser(userId, {
      store: store2,
      llm,
      embed: mockEmbed,
      now,
      log: () => {},
    });
    assert(todayRun.notesTotal === 0, `scope=today 取不到往日 inbox（实际 ${todayRun.notesTotal}）`);
    assert(
      store2.notes.get('note-old')!.status === 'inbox',
      'scope=today 后旧记录仍滞留 inbox（复现搁置）'
    );

    // scope='all'：不设时间下限 → 旧记录被整理，产出概念与卡片
    const allRun = await runDigestForUser(userId, {
      store: store2,
      llm,
      embed: mockEmbed,
      now,
      scope: 'all',
      log: () => {},
    });
    assert(allRun.notesTotal === 1, `scope=all 取到 1 条往日 inbox（实际 ${allRun.notesTotal}）`);
    assert(allRun.notesProcessed === 1, `scope=all 处理成功 1 条（实际 ${allRun.notesProcessed}）`);
    assert(
      store2.notes.get('note-old')!.status === 'processed',
      'scope=all 后旧记录 → processed（搁置已修复）'
    );
    assert(allRun.conceptsCreated >= 1, `scope=all 为旧记录产出概念（实际 ${allRun.conceptsCreated}）`);
    assert(allRun.cardsCreated >= 1, `scope=all 为旧记录产出卡片（实际 ${allRun.cardsCreated}）`);
    assert(
      allRun.period === window.period,
      `scope=all 日报 period 仍按今天 ${window.period}（实际 ${allRun.period}）`
    );

    // 幂等：再跑一次，已 processed 不再入选
    const allRun2 = await runDigestForUser(userId, {
      store: store2,
      llm,
      embed: mockEmbed,
      now,
      scope: 'all',
      log: () => {},
    });
    assert(allRun2.notesTotal === 0, `scope=all 幂等：已 processed 不重复处理（实际 ${allRun2.notesTotal}）`);
  }

  // ============ cron 自愈：runDigestForAllUsers 含往日漏整理 ============
  console.log('\n— cron 自愈：runDigestForAllUsers 处理往日漏整理 —');
  {
    const store3 = new MemoryStore();
    const oldIso = new Date(new Date(window.fromIso).getTime() - 36 * 3600 * 1000).toISOString();
    store3.notes.set('note-stale', {
      id: 'note-stale',
      user_id: userId,
      type: 'text',
      raw_content: '峰终定律：人对体验的记忆由峰值和结尾决定',
      transcript: null,
      url: null,
      media_path: null,
      why_important: null,
      status: 'inbox',
      created_at: oldIso,
    });

    const results = await runDigestForAllUsers({
      store: store3,
      llm,
      embed: mockEmbed,
      now,
      log: () => {},
    });
    assert(results.length === 1, `cron 选中 1 个有 inbox 的用户（实际 ${results.length}）`);
    assert(results[0]?.notesProcessed === 1, `cron 处理往日漏整理 1 条（实际 ${results[0]?.notesProcessed}）`);
    assert(
      store3.notes.get('note-stale')!.status === 'processed',
      'cron 自愈后往日记录 → processed'
    );
  }

  // ============ 单条 note 卡片封顶（MEMORY_MAX_CARDS_PER_NOTE，默认 3） ============
  // 一条 note → P1 给 3 个概念（C-甲/C-乙/C-丙，按重要性排）→ 每概念 P2 给 2 张卡（无封顶本应 6 张）。
  // 断言：最终总卡数 ≤ 3；靠前概念（C-甲）的卡优先保留；达上限后剩余概念跳过 P2（不调 LLM）。
  console.log('\n— 单条 note 卡片封顶（每条 ≤ 3 张）—');
  {
    const capStore = new MemoryStore();
    capStore.notes.set('note-cap', {
      id: 'note-cap',
      user_id: userId,
      type: 'text',
      raw_content: '一条信息量很大的记录，会被拆成多个概念',
      transcript: null,
      url: null,
      media_path: null,
      why_important: null,
      status: 'inbox',
      created_at: todayIso,
    });

    // 隔离的 mock LLM：P1 稳定给 3 概念（按重要性排）、P2 每概念给 2 张（卡文案带概念名，便于验证优先级）。
    const capCalls: { task: string; concept?: string }[] = [];
    const capLlm = buildLlmClient(async (prompt: string, opts: LlmCallOpts) => {
      switch (opts.task) {
        case 'P1':
          return JSON.stringify({
            domain: '心理学',
            topic: '综合',
            tags: ['甲', '乙', '丙'],
            summary: '一条被拆成三个概念的长记录。',
            // 按重要性从高到低：C-甲 最重要。
            concepts: [
              { name: 'C-甲', explanation: '最重要的概念甲。' },
              { name: 'C-乙', explanation: '次要的概念乙。' },
              { name: 'C-丙', explanation: '再次的概念丙。' },
            ],
          });
        case 'P2': {
          // 从 prompt 里辨认当前概念名，制两张带概念名前缀的卡（用于验证「靠前优先保留」）。
          const c = prompt.includes('C-甲') ? '甲' : prompt.includes('C-乙') ? '乙' : '丙';
          capCalls.push({ task: 'P2', concept: c });
          return JSON.stringify({
            cards: [
              { question: `${c}-Q1`, answer: `${c}-A1` },
              { question: `${c}-Q2`, answer: `${c}-A2` },
            ],
          });
        }
        case 'P3':
          return JSON.stringify({ related: false, relation_type: '', reason: '' });
        case 'P4':
          return '# 简报\n封顶测试。';
        default:
          throw new Error(`未知 task：${opts.task}`);
      }
    });

    const capRun = await runDigestForUser(userId, {
      store: capStore,
      llm: capLlm,
      embed: mockEmbed,
      now,
      log: () => {},
    });

    // 概念仍全建（封顶只作用于制卡，不影响概念/embedding/关联）。
    assert(capRun.conceptsCreated === 3, `封顶下 3 个概念仍全建（实际 ${capRun.conceptsCreated}）`);
    // 核心断言：单条 note 最终总卡数 ≤ 3（无封顶本应 6 张）。
    assert(capRun.cardsCreated <= 3, `单条 note 总卡数 ≤ 3（实际 ${capRun.cardsCreated}）`);
    assert(capStore.cards.length <= 3, `实际落库卡数 ≤ 3（实际 ${capStore.cards.length}）`);
    assert(
      capRun.cardsCreated === capStore.cards.length,
      `cardsCreated 按实际插入数计（result=${capRun.cardsCreated} / 落库=${capStore.cards.length}）`
    );
    // 靠前概念优先：C-甲 的两张卡应都在（额度 3 = 甲2 + 乙1），且不应出现最靠后 C-丙 的卡。
    const capQuestions = capStore.cards.map((c) => c.question);
    assert(
      capQuestions.includes('甲-Q1') && capQuestions.includes('甲-Q2'),
      '靠前概念 C-甲 的卡优先保留（甲-Q1 / 甲-Q2 均在）'
    );
    assert(
      !capQuestions.some((q) => q.startsWith('丙-')),
      '达上限后最靠后概念 C-丙 未制卡（其卡不在）'
    );
    // 达上限后剩余概念跳过 P2：P2 只应被调用 2 次（甲、乙），C-丙 不调。
    assert(
      capCalls.filter((c) => c.task === 'P2').length === 2,
      `达上限后跳过 P2：P2 仅调用 2 次（甲/乙），C-丙 跳过（实际 ${capCalls.filter((c) => c.task === 'P2').length}）`
    );
    assert(
      !capCalls.some((c) => c.task === 'P2' && c.concept === '丙'),
      'C-丙 未触发 P2 调用（省 LLM 成本）'
    );
  }

  console.log(
    `\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}（LLM mock 调用共 ${llmCalls.length} 次）`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('测试脚本异常：', err);
  process.exit(1);
});
