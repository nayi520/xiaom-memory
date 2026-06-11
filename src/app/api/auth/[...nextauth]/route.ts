/**
 * NextAuth (Auth.js v5) 路由挂载点 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 暴露 /api/auth/* 全部端点（signin / callback / session / csrf / signout / verify-request 等）。
 * handlers 来自 src/lib/auth/config.ts 的 NextAuth() 工厂。
 *
 * 本路由为**新增**，不与现有 src/app/auth/callback（Supabase magic link 回调）冲突；
 * 集成阶段再决定保留/下线旧回调。
 */

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;

// Auth.js 依赖 cookies/headers，强制动态渲染，避免被静态化。
export const dynamic = 'force-dynamic';
