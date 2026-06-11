/**
 * 鉴权对外入口 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 全站统一从这里取鉴权能力，便于将来一处替换 supabase.auth.*：
 *   - auth / signIn / signOut：Auth.js v5 服务端 API（auth() 取当前 session）。
 *   - getCurrentUser()：薄封装，返回 { id, email } | null，
 *     直接对位现有 `const { data:{ user } } = await supabase.auth.getUser()` 的用法。
 *
 * 接线阶段（后续）用法示例（替换 supabase 版）：
 *   import { getCurrentUser } from '@/lib/auth';
 *   const user = await getCurrentUser();
 *   if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
 *   // user.id 即原来的 user.id，可直接用于 Drizzle 的 userId 过滤。
 */

// 引入类型增强（Session.user.id / JWT.uid），确保下方返回类型正确。
import './types';
import { auth, signIn, signOut, handlers } from './config';

export { auth, signIn, signOut, handlers };

/** 当前登录用户的精简视图（对位 supabase 的 user.id / user.email） */
export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * 取当前登录用户。
 * - 已登录：返回 { id, email }（id = 内部 users.id）。
 * - 未登录 / 无会话：返回 null。
 *
 * 用于全站替换 `supabase.auth.getUser()`。基于 JWT session，
 * 无需查库即可拿到 id/email（性能等价于读 cookie + 验签）。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return {
    id,
    email: session.user.email ?? null,
  };
}
