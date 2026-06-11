/**
 * Drizzle schema —— 去 Supabase 改造（P1 数据层骨架）
 *
 * 事实来源：supabase/migrations/0001~0005。本 schema 与之**字段/索引对齐**，差异仅在鉴权：
 *   - 新增自建 `users` 表取代 Supabase 的 `auth.users`（不再依赖 Supabase Auth）；
 *   - 所有 user_id 外键改指向本表；profiles.id 同样指向本表（保留扩展 settings）；
 *   - 不建 RLS（授权改走应用层 userId 过滤），故本文件不含任何 policy。
 *
 * 本阶段为**新增、暂未接线**：现有 supabase.from() 查询不动，待 RDS 就绪后由后续阶段逐步切换。
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
} from 'drizzle-orm/pg-core';

// ============ 自定义 pgvector 类型：vector(1536) ============
// drizzle-orm 内置无 pgvector 列类型；用 customType 映射到 PG 的 `vector(N)`。
// - driver 侧以字符串 '[a,b,c]' 收发（pgvector 文本表示），应用层用 number[] 读写。
// - dimensions 通过参数传入，生成 DDL 时拼成 `vector(1536)`。
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return config?.dimensions ? `vector(${config.dimensions})` : 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector 返回形如 '[0.1,0.2,...]'
    return value
      .slice(1, -1)
      .split(',')
      .filter((s) => s.length > 0)
      .map(Number);
  },
});

/** 概念向量维度（= OpenAI/text-embedding-v4 的 1536，与 concepts.embedding 对齐） */
export const EMBEDDING_DIMENSIONS = 1536;

// ============ users：自建鉴权主表（取代 Supabase auth.users） ============
// 与 auth.users 的差异：
//   - 仅保留业务必需列：id / email / apple_sub / created_at（不含密码哈希、第三方 metadata 等）；
//   - email 唯一（magic link 登录主键）；apple_sub 唯一（Apple 登录 subject，可空）。
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    appleSub: text('apple_sub'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailKey: uniqueIndex('users_email_key').on(t.email),
    appleSubKey: uniqueIndex('users_apple_sub_key').on(t.appleSub),
  })
);

// ============ profiles：用户扩展（settings jsonb） ============
export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ============ notes：原始记录（含软删除 deleted_at + AI 摘要 summary） ============
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    rawContent: text('raw_content'),
    transcript: text('transcript'),
    url: text('url'),
    mediaPath: text('media_path'),
    whyImportant: text('why_important'),
    status: text('status').notNull().default('inbox'),
    summary: text('summary'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStatusIdx: index('notes_user_status_idx').on(
      t.userId,
      t.status,
      t.createdAt.desc()
    ),
    userDeletedIdx: index('notes_user_deleted_idx').on(t.userId, t.deletedAt),
    typeCheck: check(
      'notes_type_check',
      sql`${t.type} in ('text', 'voice', 'link', 'image')`
    ),
    statusCheck: check(
      'notes_status_check',
      sql`${t.status} in ('inbox', 'processed', 'needs_review', 'archived')`
    ),
  })
);

// ============ concepts：知识原子（embedding vector(1536)） ============
export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    summary: text('summary'),
    domain: text('domain'),
    topic: text('topic'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('concepts_user_idx').on(t.userId, t.createdAt.desc()),
    userDomainTopicIdx: index('concepts_user_domain_topic_idx').on(
      t.userId,
      t.domain,
      t.topic
    ),
    // pgvector cosine 近邻索引（ivfflat）——与迁移 0002 对齐
    embeddingIdx: index('concepts_embedding_idx')
      .using('ivfflat', t.embedding.op('vector_cosine_ops'))
      .with({ lists: 100 }),
  })
);

// ============ note_concepts：notes × concepts 多对多 ============
export const noteConcepts = pgTable(
  'note_concepts',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.noteId, t.conceptId] }),
  })
);

// ============ concept_links：AI 发现的关联（relation_type + reason） ============
export const conceptLinks = pgTable(
  'concept_links',
  {
    conceptA: uuid('concept_a')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    conceptB: uuid('concept_b')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    relationType: text('relation_type'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conceptA, t.conceptB] }),
  })
);

// ============ cards：复习卡片（fsrs_state jsonb） ============
export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    fsrsState: jsonb('fsrs_state').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    conceptIdx: index('cards_concept_idx').on(t.conceptId),
    // 到期查询索引：fsrs_state->>'due'（ISO 字符串字典序=时间序），仅 active 卡
    activeDueIdx: index('cards_active_due_idx')
      .on(sql`(${t.fsrsState}->>'due')`)
      .where(sql`${t.status} = 'active'`),
    statusCheck: check(
      'cards_status_check',
      sql`${t.status} in ('active', 'graduated', 'suspended')`
    ),
  })
);

// ============ reviews：复习日志（rating 1~4） ============
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cardIdx: index('reviews_card_idx').on(t.cardId, t.reviewedAt.desc()),
    ratingCheck: check('reviews_rating_check', sql`${t.rating} between 1 and 4`),
  })
);

// ============ tags / note_tags ============
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => ({
    userNameKey: uniqueIndex('tags_user_id_name_key').on(t.userId, t.name),
  })
);

export const noteTags = pgTable(
  'note_tags',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.noteId, t.tagId] }),
  })
);

// ============ digests：日报/周报（user+type+period 唯一） ============
export const digests = pgTable(
  'digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    contentMd: text('content_md').notNull(),
    period: text('period').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('digests_user_idx').on(t.userId, t.type, t.period),
    userTypePeriodKey: uniqueIndex('digests_user_type_period_key').on(
      t.userId,
      t.type,
      t.period
    ),
    typeCheck: check('digests_type_check', sql`${t.type} in ('daily', 'weekly')`),
  })
);

// ============ corrections：用户对 AI 结果的修正记录 ============
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    field: text('field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('corrections_user_idx').on(t.userId, t.createdAt.desc()),
    targetTypeCheck: check(
      'corrections_target_type_check',
      sql`${t.targetType} in ('note', 'concept', 'card', 'tag')`
    ),
  })
);

// ============ push_subscriptions：Web Push 订阅 ============
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    keys: jsonb('keys').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    endpointKey: uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
    userIdx: index('push_subscriptions_user_idx').on(t.userId),
  })
);

// ============ 表类型导出（供后续 Drizzle 查询层用） ============
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type ConceptRow = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
export type CardRow = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type ReviewRow = typeof reviews.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type DigestRow = typeof digests.$inferSelect;
export type CorrectionRow = typeof corrections.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
