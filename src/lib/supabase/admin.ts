import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 服务端管理客户端（service role，绕过 RLS）。
 * 仅用于 cron / 后台流水线，禁止暴露到浏览器。
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('未配置 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
