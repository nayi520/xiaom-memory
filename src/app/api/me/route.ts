import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me —— 当前登录用户的精简视图（去 Supabase 改造）
 *
 * 取代浏览器端 supabase.auth.getUser()：客户端组件需要 user.id 时（如语音上传构造
 * Storage 路径）改请求本端点。未登录返回 401。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return NextResponse.json({ id: user.id, email: user.email });
}
