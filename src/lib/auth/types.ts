/**
 * Auth.js 类型增强 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 给 Session.user 增加内部 `id`（=users.id），给 JWT 增加 `uid`，
 * 使 config.ts 的 callbacks 与 getCurrentUser() 类型正确。
 * 仅声明类型，无运行时副作用。
 */

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      /** 内部 users.id（uuid）——授权按 userId 过滤的依据 */
      id: string;
    } & DefaultSession['user'];
  }
}

// 不增强 JWT：v5 的 JWT 继承 Record<string, unknown>，token.uid 可直接读写（callbacks 内已做 typeof 收窄）。
