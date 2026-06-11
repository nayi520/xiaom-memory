/**
 * Edge 安全的 Auth.js 实例 —— 仅供中间件使用（去 Supabase 改造 · Phase B 接线）
 *
 * 为什么单独一份：
 *   中间件跑在 Edge runtime，而完整 config.ts 通过 adapter.ts → getDb() 引入 postgres.js，
 *   又经 email.ts → directmail.ts 引入 node:crypto，二者都**不被 Edge 支持**，
 *   直接在中间件 import 完整 `auth` 会导致 Edge 打包失败。
 *
 * Auth.js v5 官方「split config」做法：中间件只需**验证 JWT**（读 cookie + 验签），
 *   不调用 adapter / providers。故此处用一份最小配置（仅 secret + session 策略 + callbacks），
 *   不含 adapter、不含 providers——足以让 middleware 通过 req.auth 取到 session.user.id。
 *
 * 注意：登录/登出/回调等真正用到 adapter & providers 的流程，仍走 config.ts 的完整实例
 *   （挂在 /api/auth 的 route handler，Node runtime）。两份实例共享同一 AUTH_SECRET，
 *   因此中间件能正确验签完整实例签发的 JWT。
 */

import './types';
import NextAuth, { type NextAuthConfig } from 'next-auth';

const edgeConfig: NextAuthConfig = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/login?check=email',
  },
  // 中间件不发起登录，providers 留空即可（JWT 验证不依赖 providers）。
  providers: [],
  callbacks: {
    // 与 config.ts 保持一致：把 token.uid / email 暴露到 session.user，供中间件读取。
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.uid === 'string') session.user.id = token.uid;
        if (typeof token.email === 'string') session.user.email = token.email;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
};

export const { auth } = NextAuth(edgeConfig);
