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

import NextAuth, { type NextAuthConfig, CredentialsSignin } from 'next-auth';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { DrizzleMinimalAdapter } from './adapter';
import { directMailProvider } from './email';
import { verifyPassword, isValidEmail } from './password';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

/**
 * 邮箱未验证时抛出的凭证登录错误（注册门禁加固 · 登录门禁）。
 * Auth.js 把 `code` 透传到回流 URL 的 ?code=，next-auth/react 的 signIn 返回 result.code，
 * 登录页据此显示「请先验证邮箱」并提供重发入口。code 不含敏感信息（仅状态名）。
 */
class EmailNotVerifiedError extends CredentialsSignin {
  code = 'EmailNotVerified';
}

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
    // ============ 邮箱 + 密码（主登录方式，V1） ============
    // authorize：按 email 查 user → bcrypt.compare 校验 password_hash → 通过返回 {id,email}。
    // 返回的 user 进入 jwt callback 注入 uid（沿用现有 jwt/session 注入逻辑）。
    // 安全：任一失败（用户不存在 / 无密码 / 密码错）一律返回 null，不区分原因、不打印密码。
    Credentials({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        // 基本输入校验：邮箱格式 + 密码非空（长度策略在注册端强制）。
        if (!isValidEmail(email) || !password) return null;

        const db = getDb();
        // 直接查库取 password_hash + email_verified（adapter.toAdapterUser 不暴露哈希）。
        const [row] = await db
          .select({
            id: users.id,
            email: users.email,
            passwordHash: users.passwordHash,
            emailVerified: users.emailVerified,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!row) return null;

        const ok = await verifyPassword(password, row.passwordHash);
        if (!ok) return null;

        // 登录门禁（注册门禁加固）：邮箱未验证一律拒绝登录，提示去验证 / 重发。
        // 注意：密码正确才走到这里 → 抛 EmailNotVerified 不泄露「密码是否正确」给未注册者
        //（未注册 / 密码错都在上面 return null）。Apple / magic link 用户 email_verified 已为 true。
        if (!row.emailVerified) {
          throw new EmailNotVerifiedError();
        }

        // 仅返回稳定 id + email；jwt callback 据 user.id 注入 token.uid。
        return { id: row.id, email: row.email ?? email };
      },
    }),

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
