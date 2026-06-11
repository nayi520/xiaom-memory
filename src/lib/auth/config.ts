/**
 * NextAuth (Auth.js v5) 配置 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 目标：用 Auth.js 取代 Supabase Auth，提供
 *   - **Email magic link**：自定义 sendVerificationRequest → 阿里云 DirectMail 发信；
 *   - **Apple 登录**：Apple OIDC（验证 identity token），把 sub 落到 users.apple_sub；
 *   - session 策略 **JWT**（免 DB session 表，契合精简 users 表 + 单人自用）。
 *
 * 与现有体系的边界（本阶段「只写不接线」）：
 *   - 不改 middleware.ts / 现有 login 页 / supabase/*；集成（替换 getUser、路由保护）留后续。
 *   - adapter 用本地最小 Drizzle 适配器（adapter.ts），仅实现 JWT + magic link + Apple 所需子集。
 *
 * 依赖（未安装，见 DEPS.md，由统一构建阶段装）：next-auth@beta。
 *   注意：magic link **刻意不走** nodemailer/Email provider（它们顶层 import nodemailer），
 *   改用 email.ts 手工构造的 type:'email' provider → 无 nodemailer 依赖。
 * 环境变量见 DEPS.md：AUTH_SECRET、AUTH_URL、APPLE_*、DIRECTMAIL_*。
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Apple from 'next-auth/providers/apple';
import { DrizzleMinimalAdapter } from './adapter';
import { directMailProvider } from './email';

/**
 * Auth.js 配置对象。
 * Email magic link 用 directMailProvider()（type:'email'，发信走 DirectMail，无 SMTP）。
 */
export const authConfig: NextAuthConfig = {
  // 自建最小 Drizzle 适配器（users + verification_tokens）。
  adapter: DrizzleMinimalAdapter(),

  // —— 会话：JWT（无 DB session 表）——
  session: {
    strategy: 'jwt',
    // 30 天滑动过期；可按需调整。
    maxAge: 30 * 24 * 60 * 60,
  },

  // 信任部署域（ECS + Nginx 反代），生产由 AUTH_URL / AUTH_TRUST_HOST 控制。
  trustHost: true,

  // 登录页沿用现有 /login（本阶段不改该页，仅声明路由，集成时对接）。
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/login?check=email',
  },

  providers: [
    // ============ Email magic link（DirectMail 发信，无 nodemailer） ============
    directMailProvider(),

    // ============ Apple 登录（OIDC，验证 identity token） ============
    // 凭证默认从 env 读取：AUTH_APPLE_ID（Service ID）/ AUTH_APPLE_SECRET（Team/Key/私钥签出的 client_secret JWT）。
    // 这里显式传入以便用统一前缀 APPLE_* 覆盖；任一为空时回落到 Auth.js 的 AUTH_APPLE_* 约定。
    // Auth.js 的 Apple provider 走 OIDC，自动校验 id_token，sub 落在 account.providerAccountId。
    Apple({
      clientId: process.env.APPLE_CLIENT_ID ?? process.env.AUTH_APPLE_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? process.env.AUTH_APPLE_SECRET,
      // Apple 仅在首次授权返回 name；本项目只需 sub（落 apple_sub）+ email。
    }),
  ],

  callbacks: {
    /**
     * 把稳定的内部 users.id 注入 JWT。
     * - 首次登录时 `user` 存在（来自 adapter 的 createUser/getUserBy*），取 user.id；
     * - Apple 路径下，account.provider==='apple' 时 user 已由 linkAccount 关联 apple_sub。
     */
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        if (user.email) token.email = user.email;
      }
      return token;
    },

    /**
     * 把 token.uid 暴露到 session.user.id，供 getCurrentUser() / 全站读取。
     */
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.uid === 'string') session.user.id = token.uid;
        if (typeof token.email === 'string') session.user.email = token.email;
      }
      return session;
    },
  },

  // AUTH_SECRET 由环境变量提供（生产必填）；缺失时 Auth.js 在运行时报错，不在 import 期崩溃。
  secret: process.env.AUTH_SECRET,
};

/**
 * NextAuth v5 工厂：导出 handlers（挂到 route.ts）与服务端 auth()/signIn()/signOut()。
 * 这些再由 index.ts 统一对外暴露。
 */
export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth(authConfig);
