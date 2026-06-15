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
  boolean,
  timestamp,
  date,
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
//   - 业务必需列：id / email / apple_sub / password_hash / created_at；
//   - email 唯一（密码登录 / magic link 主键）；apple_sub 唯一（Apple 登录 subject，可空）。
//   - password_hash 可空：邮箱+密码登录用 bcrypt 哈希（cost=12）；老魔法链接 / Apple 用户为 null。
//   - name / avatar_key：用户资料（显示名 + 头像）。avatar_key 是 OSS 私有对象 key
//     （形如 `avatars/{userId}/{uuid}.<ext>`），展示时现签为临时 URL，不存公网地址；二者均可空。
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    appleSub: text('apple_sub'),
    // bcrypt 密码哈希（永不存明文）；可空：仅邮箱+密码用户有值。
    passwordHash: text('password_hash'),
    // 显示用户名（可空，1–24 字符由应用层校验）。
    name: text('name'),
    // 头像在 OSS 的对象 key（私有 bucket，展示靠 getSignedUrl 现签）。可空：未设头像为 null。
    avatarKey: text('avatar_key'),
    // 邮箱是否已验证。注册门禁加固（0003）：邮箱+密码注册建 false，点验证链接后置 true；
    // Apple 登录视为已验证（linkAccount 时置 true）；迁移把现有行回填为 true，避免锁住老用户。
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailKey: uniqueIndex('users_email_key').on(t.email),
    appleSubKey: uniqueIndex('users_apple_sub_key').on(t.appleSub),
  })
);

// ============ invite_codes：邀请制注册（注册门禁加固 0003） ============
// REGISTRATION_MODE=invite 时，/api/register 必须带有效、未过期、used_count<max_uses 的码；
// 注册成功在事务内 used_count+1。管理员发码：POST /api/admin/invite（Bearer ADMIN_SECRET）或 SQL 直插。
export const inviteCodes = pgTable('invite_codes', {
  // 邀请码字符串本身即主键（大小写敏感，生成时用无歧义字符集）。
  code: text('code').primaryKey(),
  // 备注（发给谁 / 用途），仅管理用，可空。
  note: text('note'),
  // 最多可用次数（默认 1，单次邀请）。
  maxUses: integer('max_uses').notNull().default(1),
  // 已用次数（事务内自增；used_count<max_uses 才算有效）。
  usedCount: integer('used_count').notNull().default(0),
  // 过期时间（可空 = 永不过期）。
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ============ email_verifications：邮箱验证一次性令牌（注册门禁加固 0003） ============
// 注册时生成带过期的 token，邮件发链接 GET /api/verify-email?token=；校验后置 users.email_verified=true。
// 一次性：用后即删（与 magic link 的 verification_tokens 同理，但按 user_id 关联、单列 token 主键）。
export const emailVerifications = pgTable('email_verifications', {
  // 不透明随机 token（主键）。绝不打印；过期 + 一次性。
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

// ============ usage_counters：per-user 每日 AI 用量计数（成本/滥用闸 0004） ============
// 主键 (user_id, day, kind) 唯一标识「某用户某 UTC 日某类 AI 操作」的累计次数。
//   - day：UTC 日历日（与 stats 口径一致，应用层用 new Date().toISOString().slice(0,10) 计算）。
//   - kind：'ask' | 'transcribe' | 'clip' | 'embedding'（付费 AI 端点；上限由 env 配置）。
//   - count：原子自增（insert ... on conflict do update set count=count+1 returning count），判超额。
// 仅计量、不存敏感内容；用户删除时随 FK 级联清理。历史行天然留存，便于审计/统计。
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    kind: text('kind').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.day, t.kind] }),
  })
);

// ============ 表类型导出（供后续 Drizzle 查询层用） ============
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type InviteCodeRow = typeof inviteCodes.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
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
export type UsageCounterRow = typeof usageCounters.$inferSelect;
