/**
 * AI 每日整理流水线（PRD F2 / 5.3）
 *
 * 流程：取当日 inbox notes → 语音先 P7 清洗 → 每条 P1（分类/标签/摘要/概念）
 *      → 每概念 P2 制卡 + embedding 入 pgvector → match_concepts 检索相似历史概念
 *      → 每对调 P3 确认关联 → 全部完成后 P4 生成日报 → notes 标记 processed。
 * 单条失败标记 needs_review，不阻塞批处理。
 *
 * 数据访问通过 DigestStore 接口注入（生产用 Drizzle 实现，测试用内存实现）。
 */

import {
  GLOBAL_SYSTEM,
  buildP1Prompt,
  buildP2Prompt,
  buildP3Prompt,
  buildP4Prompt,
  buildP7Prompt,
  type P1Result,
  type P2Result,
  type P3Result,
} from './prompts';
import type { LlmClient } from '@/lib/llm';
import type { EmbedFn } from '@/lib/embeddings';
import { EmbeddingKeyMissingError } from '@/lib/embeddings';
import type { Note } from '@/lib/types';

// ============ 常量 ============

/** 概念相似度阈值（cosine），超过才调 P3 确认 */
export const SIMILARITY_THRESHOLD = 0.82;
/** 每个新概念最多取多少条相似历史概念 */
export const MATCH_LIMIT = 5;
/** P1 注入的最近修正条数 */
export const CORRECTIONS_LIMIT = 5;
/** 默认时区（"当日"按此计算） */
export const DIGEST_TIMEZONE = 'Asia/Shanghai';

/**
 * 单条 note 最多产出的复习卡数（硬封顶）。默认 3；env `MEMORY_MAX_CARDS_PER_NOTE` 可调，
 * 非法 / 非正值回退 3。作用：输入内容较多时，一条 note 会被 P1 拆成多个概念、每概念 P2 又制 1-2 张，
 * 无封顶时单条最多约 6 张。这里在概念循环内累计"本条已建卡数"，按剩余额度 slice 每概念的 P2 结果；
 * 累计达上限后剩余概念**跳过 P2**（概念仍建 + embedding + 关联，只是不再制卡，省 LLM 成本），
 * 优先保留靠前（P1 通常按重要性排）概念的卡。只作用于新整理，不影响已存在的卡。
 */
export const MAX_CARDS_PER_NOTE = (() => {
  const n = Number(process.env.MEMORY_MAX_CARDS_PER_NOTE);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 3;
})();

// ============ 数据访问接口 ============

export interface MatchedConcept {
  id: string;
  name: string;
  summary: string | null;
  created_at: string;
  similarity: number;
  source: string | null;
}

export interface NewCard {
  question: string;
  answer: string;
}

export interface CorrectionRow {
  target_type: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface DigestStore {
  /** 当日窗口内有 inbox 记录的全部用户（cron 全量跑用） */
  listUserIdsWithInbox(fromIso: string, toIso: string): Promise<string[]>;
  /**
   * 截至 toIso（不设时间下限）仍有 inbox 记录的全部用户（cron 自愈：含往日漏整理）。
   * 用 `<= toIso`，把"今天之前没跑到的天"一并纳入，避免漏跑的日子永久搁置。
   */
  listUserIdsWithInboxUpTo(toIso: string): Promise<string[]>;
  /** 某用户当日窗口内的 inbox 记录 */
  listInboxNotes(userId: string, fromIso: string, toIso: string): Promise<Note[]>;
  /**
   * 某用户【全部】待整理（inbox）记录，不设时间下限（"立即整理"补积压用）。
   * 仍按 status=inbox + 排除软删 + 限定本人；按 created_at 升序。
   */
  listAllInboxNotes(userId: string): Promise<Note[]>;
  /** 现有类目体系 {领域: [主题...]} */
  getDomainsTopics(userId: string): Promise<Record<string, string[]>>;
  /** 最近 N 条用户修正记录 */
  getRecentCorrections(userId: string, limit: number): Promise<CorrectionRow[]>;
  /** 更新 note（status / summary / raw_content 等） */
  updateNote(noteId: string, patch: Partial<Pick<Note, 'status' | 'summary' | 'raw_content'>>): Promise<void>;
  /** 新建概念，返回 id */
  insertConcept(
    userId: string,
    concept: { name: string; summary: string; domain: string; topic: string }
  ): Promise<string>;
  setConceptEmbedding(conceptId: string, embedding: number[]): Promise<void>;
  linkNoteConcept(noteId: string, conceptId: string): Promise<void>;
  insertCards(conceptId: string, cards: NewCard[], fsrsState: Record<string, unknown>): Promise<void>;
  /** 标签 upsert + note_tags 关联 */
  ensureTags(userId: string, noteId: string, tags: string[]): Promise<void>;
  /** pgvector cosine 相似检索（match_concepts SQL 函数） */
  matchConcepts(
    userId: string,
    embedding: number[],
    threshold: number,
    limit: number,
    excludeIds: string[]
  ): Promise<MatchedConcept[]>;
  insertConceptLink(
    conceptA: string,
    conceptB: string,
    relationType: string,
    reason: string
  ): Promise<void>;
  /** 日报 upsert（user_id + type + period 唯一） */
  saveDailyDigest(userId: string, period: string, contentMd: string): Promise<void>;
}

/**
 * 整理范围：
 *   - 'today'（默认）：只整理"今天"（Asia/Shanghai）创建的 inbox 记录 —— cron 每日语义。
 *   - 'all'：整理该用户【全部】待整理（inbox）记录，不设时间下限 ——
 *     "立即整理"补积压、cron 自愈漏整理用。日报 period 仍按今天，但概念/卡片提炼覆盖全部 pending。
 */
export type DigestScope = 'today' | 'all';

export interface DigestDeps {
  store: DigestStore;
  llm: LlmClient;
  embed: EmbedFn;
  /** 流水线运行时刻，默认 new Date()（按 Asia/Shanghai 折算"当日"） */
  now?: Date;
  /** 整理范围，缺省 'today'（保持 cron 每日语义）。'all' = 含往日积压。 */
  scope?: DigestScope;
  log?: (msg: string) => void;
}

export interface DigestResult {
  userId: string;
  period: string;
  notesTotal: number;
  notesProcessed: number;
  notesNeedsReview: number;
  conceptsCreated: number;
  cardsCreated: number;
  linksCreated: number;
  digestSaved: boolean;
  errors: string[];
}

// ============ 时间窗口（Asia/Shanghai 无夏令时，固定 +08:00） ============

export interface DayWindow {
  /** 'YYYY-MM-DD'（digests.period 用） */
  period: string;
  fromIso: string;
  toIso: string;
  /** 明天 00:00（Asia/Shanghai）的 ISO，作新卡初始 due */
  tomorrowIso: string;
}

export function dayWindow(now: Date = new Date()): DayWindow {
  // en-CA locale 输出 YYYY-MM-DD
  const period = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIGEST_TIMEZONE,
  }).format(now);
  const from = new Date(`${period}T00:00:00+08:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return {
    period,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    tomorrowIso: to.toISOString(),
  };
}

/** 'YYYY-MM-DD'（Asia/Shanghai），P3 的 new_date / old_date 用 */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DIGEST_TIMEZONE }).format(
    new Date(iso)
  );
}

// ============ 工具 ============

const NOTE_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  voice: '语音转写',
  link: '文章剪藏',
  image: '图片OCR',
};

/** 新卡 FSRS 初始状态（阶段 3 接 ts-fsrs 后由其接管） */
export function initialFsrsState(dueIso: string): Record<string, unknown> {
  return { stability: null, difficulty: null, reps: 0, due: dueIso };
}

function noteContent(note: Note): string {
  return (note.raw_content ?? note.transcript ?? '').trim();
}

// ============ 单用户流水线 ============

export async function runDigestForUser(
  userId: string,
  deps: DigestDeps
): Promise<DigestResult> {
  const { store, llm, embed } = deps;
  const log = deps.log ?? ((msg: string) => console.log(`[digest] ${msg}`));
  const window = dayWindow(deps.now);
  const scope: DigestScope = deps.scope ?? 'today';

  const result: DigestResult = {
    userId,
    period: window.period,
    notesTotal: 0,
    notesProcessed: 0,
    notesNeedsReview: 0,
    conceptsCreated: 0,
    cardsCreated: 0,
    linksCreated: 0,
    digestSaved: false,
    errors: [],
  };

  // scope='all'：取全部 pending（含往日积压，不设时间下限）；'today'：仅当天窗口。
  // 两者都已限定 status=inbox + 排除软删 + 限定本人（见 store）。
  const notes =
    scope === 'all'
      ? await store.listAllInboxNotes(userId)
      : await store.listInboxNotes(userId, window.fromIso, window.toIso);
  result.notesTotal = notes.length;
  log(`user=${userId} period=${window.period} scope=${scope} inbox=${notes.length}`);
  if (notes.length === 0) return result;

  const domainsTopics = await store.getDomainsTopics(userId);
  const corrections = await store.getRecentCorrections(userId, CORRECTIONS_LIMIT);

  // 本次运行新建的概念（P4 日报与排除自匹配用）
  const newConcepts: { id: string; name: string; explanation: string; createdAt: string }[] = [];
  const newLinks: { new_concept: string; old_concept: string; relation_type: string; reason: string }[] = [];
  const processedNotes: Note[] = [];
  // embedding 服务缺失时只跳过关联发现，不让整条失败
  let embeddingAvailable = true;

  for (const note of notes) {
    try {
      // ---- P7：语音转写清洗 ----
      let content = noteContent(note);
      if (note.type === 'voice' && note.transcript?.trim()) {
        const cleaned = await llm.text(
          buildP7Prompt({ raw_transcript: note.transcript }),
          { model: 'haiku', task: 'P7', system: GLOBAL_SYSTEM }
        );
        content = cleaned.trim();
        // 清洗结果写回 raw_content（transcript 保留原始转写）
        await store.updateNote(note.id, { raw_content: content });
      }

      if (!content) {
        throw new Error('记录内容为空（语音可能尚未转写）');
      }

      // ---- P1：分类 + 标签 + 摘要 + 概念提炼 ----
      const p1 = await llm.json<P1Result>(
        buildP1Prompt({
          domains_topics_json: JSON.stringify(domainsTopics),
          correction_examples: corrections.length
            ? JSON.stringify(corrections)
            : '（暂无修正记录）',
          type: NOTE_TYPE_LABELS[note.type] ?? note.type,
          content,
          why_important: note.why_important ?? '（未填写）',
          url_or_source: note.url ?? '（无）',
        }),
        { model: 'haiku', task: 'P1', system: GLOBAL_SYSTEM }
      );

      // ---- 标签 ----
      if (Array.isArray(p1.tags) && p1.tags.length > 0) {
        await store.ensureTags(userId, note.id, p1.tags);
      }

      // ---- 每个概念：建概念 →（未达封顶才）P2 制卡 → embedding → 相似检索 → P3 关联 ----
      // 本条 note 已建卡数（跨概念累计），用于对 P2 结果按剩余额度 slice、达上限后跳过 P2。
      let cardsThisNote = 0;
      for (const concept of p1.concepts ?? []) {
        const conceptId = await store.insertConcept(userId, {
          name: concept.name,
          summary: concept.explanation,
          domain: p1.domain,
          topic: p1.topic,
        });
        await store.linkNoteConcept(note.id, conceptId);
        result.conceptsCreated += 1;
        const createdAt = new Date().toISOString();
        newConcepts.push({
          id: conceptId,
          name: concept.name,
          explanation: concept.explanation,
          createdAt,
        });

        // P2 制卡（受单条 note 封顶约束）：本条已达上限则跳过 P2——不调 LLM，
        // 概念/embedding/关联照常，只是不再为这个（及后续）概念制卡，省成本。
        const remainingQuota = MAX_CARDS_PER_NOTE - cardsThisNote;
        if (remainingQuota > 0) {
          const p2 = await llm.json<P2Result>(
            buildP2Prompt({
              concept_name: concept.name,
              concept_explanation: concept.explanation,
              note_excerpt: content.slice(0, 500),
              why_important: note.why_important ?? '（未填写）',
            }),
            { model: 'haiku', task: 'P2', system: GLOBAL_SYSTEM }
          );
          // 有效卡按剩余额度 slice（如仅剩 1 张则本概念最多取 1 张），优先保留靠前概念的卡。
          const cards = (p2.cards ?? [])
            .filter((c) => c.question && c.answer)
            .slice(0, remainingQuota);
          if (cards.length > 0) {
            await store.insertCards(
              conceptId,
              cards,
              initialFsrsState(window.tomorrowIso)
            );
            result.cardsCreated += cards.length;
            cardsThisNote += cards.length;
          }
        }

        // embedding + 关联发现（embedding 不可用时跳过，不影响概念/卡片）
        if (!embeddingAvailable) continue;
        let vector: number[];
        try {
          vector = await embed(`${concept.name}：${concept.explanation}`);
        } catch (err) {
          if (err instanceof EmbeddingKeyMissingError) {
            embeddingAvailable = false;
            log('未配置 OPENAI_API_KEY，跳过 embedding 与关联发现');
            result.errors.push('embedding 未配置，关联发现已跳过');
            continue;
          }
          throw err;
        }
        await store.setConceptEmbedding(conceptId, vector);

        const matches = await store.matchConcepts(
          userId,
          vector,
          SIMILARITY_THRESHOLD,
          MATCH_LIMIT,
          newConcepts.map((c) => c.id) // 排除本次新建的概念，只匹配历史
        );

        for (const old of matches) {
          try {
            // P3 用 Sonnet 确认关联是否有启发性
            const p3 = await llm.json<P3Result>(
              buildP3Prompt({
                new_concept_name: concept.name,
                new_concept_explanation: concept.explanation,
                new_date: formatDate(createdAt),
                old_concept_name: old.name,
                old_concept_explanation: old.summary ?? '',
                old_date: formatDate(old.created_at),
                old_source: old.source ?? '未知来源',
              }),
              { model: 'sonnet', task: 'P3', system: GLOBAL_SYSTEM }
            );
            if (p3.related) {
              await store.insertConceptLink(
                conceptId,
                old.id,
                p3.relation_type,
                p3.reason
              );
              result.linksCreated += 1;
              newLinks.push({
                new_concept: concept.name,
                old_concept: old.name,
                relation_type: p3.relation_type,
                reason: p3.reason,
              });
            }
          } catch (err) {
            // 关联失败只记日志，概念与卡片已落库，不标 needs_review
            const msg = err instanceof Error ? err.message : String(err);
            log(`P3 关联确认失败（concept=${concept.name} × ${old.name}）：${msg}`);
            result.errors.push(`P3 失败：${concept.name} × ${old.name}`);
          }
        }
      }

      // ---- 本条完成 ----
      await store.updateNote(note.id, {
        status: 'processed',
        summary: p1.summary,
      });
      processedNotes.push({ ...note, summary: p1.summary });
      result.notesProcessed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`note=${note.id} 整理失败，标记 needs_review：${msg}`);
      result.errors.push(`note ${note.id}: ${msg}`);
      try {
        await store.updateNote(note.id, { status: 'needs_review' });
        result.notesNeedsReview += 1;
      } catch (markErr) {
        const m = markErr instanceof Error ? markErr.message : String(markErr);
        result.errors.push(`note ${note.id} 标记 needs_review 失败: ${m}`);
      }
    }
  }

  // ---- P4：日报（至少有一条处理成功才生成） ----
  if (processedNotes.length > 0) {
    try {
      const digestMd = await llm.text(
        buildP4Prompt({
          today_notes_json: JSON.stringify(
            processedNotes.map((n) => ({
              type: NOTE_TYPE_LABELS[n.type] ?? n.type,
              summary: n.summary ?? '',
              why_important: n.why_important ?? '',
            }))
          ),
          new_concepts_json: JSON.stringify(
            newConcepts.map((c) => ({ name: c.name, explanation: c.explanation }))
          ),
          new_links_json: JSON.stringify(newLinks),
        }),
        { model: 'haiku', task: 'P4', system: GLOBAL_SYSTEM }
      );
      await store.saveDailyDigest(userId, window.period, digestMd.trim());
      result.digestSaved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`P4 日报生成失败：${msg}`);
      result.errors.push(`P4 日报失败: ${msg}`);
    }
  }

  log(
    `user=${userId} 完成：processed=${result.notesProcessed}/${result.notesTotal} ` +
      `needs_review=${result.notesNeedsReview} concepts=${result.conceptsCreated} ` +
      `cards=${result.cardsCreated} links=${result.linksCreated} digest=${result.digestSaved}`
  );
  return result;
}

// ============ 全量流水线（cron 用：所有有 inbox 的用户） ============

export async function runDigestForAllUsers(deps: DigestDeps): Promise<DigestResult[]> {
  const window = dayWindow(deps.now);
  // cron 自愈（catch-up）：取截至今天结束仍有 inbox 的全部用户（不设下限），
  // 把"今天之前漏整理的天"一并纳入，使漏跑的日子不再永久搁置。
  // 每个用户以 scope='all' 跑：清掉其全部 pending（含往日积压）；已 processed 不会再入选（幂等）。
  // 用户归属由 listUserIdsWithInboxUpTo + runDigestForUser 内按 userId 过滤保证。
  const userIds = await deps.store.listUserIdsWithInboxUpTo(window.toIso);
  const perUserDeps: DigestDeps = { ...deps, scope: 'all' };
  const results: DigestResult[] = [];
  for (const userId of userIds) {
    // 单个用户失败不阻塞其他用户
    try {
      results.push(await runDigestForUser(userId, perUserDeps));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[digest] user=${userId} 流水线异常：${msg}`);
      results.push({
        userId,
        period: window.period,
        notesTotal: 0,
        notesProcessed: 0,
        notesNeedsReview: 0,
        conceptsCreated: 0,
        cardsCreated: 0,
        linksCreated: 0,
        digestSaved: false,
        errors: [msg],
      });
    }
  }
  return results;
}
