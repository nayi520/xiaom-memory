/**
 * 最小 Drizzle Auth.js 适配器 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 为什么自写而不用 @auth/drizzle-adapter：
 *   官方适配器要求一整套表（users/accounts/sessions/verificationTokens）且列名固定，
 *   而本项目的 `users` 表是**精简自建表**（仅 id/email/apple_sub/created_at，见 db/schema.ts），
 *   且 session 走 **JWT**（database strategy 用不到 sessions 表）。
 *   因此只实现 JWT + Email magic link + OAuth(Apple) 真正需要的子集：
 *     - createUser / getUser / getUserByEmail / getUserByAccount / updateUser
 *     - linkAccount / getUserByAccount（Apple：把 providerAccountId=sub 关联到 users.apple_sub）
 *     - createVerificationToken / useVerificationToken（magic link）
 *   不实现 session 系列（JWT 模式不会被调用）。
 *
 * 依赖两张表：
 *   1. 现有 `users`（db/schema.ts）—— email upsert / apple_sub 落库；
 *   2. 新增 `verification_tokens`（identifier+token，magic link 一次性令牌）。
 *      本文件**就地定义**该表（不改共享 schema.ts，避免与并发 agent 冲突）；
 *      其建表 DDL 见 src/lib/auth/DEPS.md，联调前需在 RDS 执行。
 *
 * 离线/无库降级：getDb() 在缺 DATABASE_URL 时抛 DatabaseUrlMissingError，
 *   由上层（NextAuth 流程）冒泡为明确错误，符合「P2 可离线部分」只写不接线的边界。
 */

import type {
  Adapter,
  AdapterUser,
  AdapterAccount,
  VerificationToken,
} from 'next-auth/adapters';
import { and, eq } from 'drizzle-orm';
import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

/**
 * magic link 一次性验证令牌表（Auth.js Email provider 用）。
 * 就地定义，DDL 见 DEPS.md：
 *   create table verification_tokens (
 *     identifier text not null,
 *     token text not null,
 *     expires timestamptz not null,
 *     primary key (identifier, token)
 *   );
 */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  })
);

/** 把自建 users 行映射成 Auth.js 的 AdapterUser（email 必填，故对 null 兜底为空串） */
function toAdapterUser(row: typeof users.$inferSelect): AdapterUser {
  return {
    id: row.id,
    // 自建 users.email 可空，但 AdapterUser.email 为 string；magic link 场景必有值。
    email: row.email ?? '',
    // 本项目不做邮箱验证态机，登录成功即视为已验证（用 createdAt 兜底）。
    emailVerified: row.createdAt ?? null,
  };
}

/**
 * 最小 Drizzle 适配器工厂。
 * 仅在 JWT session 策略下使用；session 系列方法刻意不实现。
 */
export function DrizzleMinimalAdapter(): Adapter {
  return {
    async createUser(user) {
      const db = getDb();
      // Auth.js 传入的 user.id 可能是它生成的；本表用 defaultRandom，忽略传入 id 以库内 uuid 为准。
      const [row] = await db
        .insert(users)
        .values({ email: user.email })
        .returning();
      return toAdapterUser(row);
    },

    async getUser(id) {
      const db = getDb();
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      // 本项目只接 Apple（OIDC）；把 providerAccountId 当作 Apple 的 sub，匹配 users.apple_sub。
      // 其它 provider 暂不支持账号关联表，返回 null（不会命中已存在用户，将走 createUser）。
      if (provider !== 'apple') return null;
      const db = getDb();
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.appleSub, providerAccountId))
        .limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async updateUser(user) {
      const db = getDb();
      const [row] = await db
        .update(users)
        .set({ email: user.email ?? undefined })
        .where(eq(users.id, user.id))
        .returning();
      return toAdapterUser(row);
    },

    async linkAccount(account: AdapterAccount) {
      // 仅处理 Apple：把 sub（providerAccountId）写回该用户的 apple_sub。
      // 无独立 accounts 表（JWT 模式不需要完整 OAuth 账号记录），故只落 apple_sub。
      if (account.provider !== 'apple') return;
      const db = getDb();
      await db
        .update(users)
        .set({ appleSub: account.providerAccountId })
        .where(eq(users.id, account.userId));
      // 返回值被 Auth.js 忽略
    },

    async createVerificationToken(token: VerificationToken) {
      const db = getDb();
      await db.insert(verificationTokens).values({
        identifier: token.identifier,
        token: token.token,
        expires: token.expires,
      });
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      const db = getDb();
      // 取出并删除（一次性）。先查再删，返回被消费的令牌；不存在返回 null。
      const [row] = await db
        .select()
        .from(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, identifier),
            eq(verificationTokens.token, token)
          )
        )
        .limit(1);
      if (!row) return null;

      await db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, identifier),
            eq(verificationTokens.token, token)
          )
        );

      return {
        identifier: row.identifier,
        token: row.token,
        expires: row.expires,
      };
    },
  };
}
