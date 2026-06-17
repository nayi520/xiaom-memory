'use client';

/**
 * 统一「退出登录」入口（V18 离线队列账号边界）。
 *
 * 退出前先清空本地离线队列（outbox），再走 next-auth signOut 落地登录页：
 * 离线草稿以「浏览器」存储、不区分账号，若不清空，下一个在同一浏览器登录的账号会把上一个人的
 * 草稿发到自己名下（串号）。清空是更安全的取舍（宁可本地丢弃未同步草稿，也不串号给他人）。
 *
 * 供侧栏「退出」按钮与「会话过期」重登浮层共用，确保两条退出路径口径一致。
 */

import { signOut } from 'next-auth/react';
import { clearOutbox } from '@/features/offline/queue';

export async function signOutAndClear(callbackUrl = '/login'): Promise<void> {
  // 清空失败也不阻断退出（clearOutbox 内部已吞错）。
  await clearOutbox().catch(() => {});
  await signOut({ callbackUrl });
}
