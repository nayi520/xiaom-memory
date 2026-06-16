import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { getReviewQueue } from '@/features/review/queue';
import type { ReviewMode } from '@/features/review/types';

export const dynamic = 'force-dynamic';

/** 解析 mode 查询参数（缺省/非法回落 'due'）。 */
function parseMode(raw: string | null): ReviewMode {
  return raw === 'all' || raw === 'leech' ? raw : 'due';
}

/**
 * GET /api/review/queue —— 复习队列（JSON，供 iOS 原生端用；V14 增模式与领域过滤）
 *
 * Query（均可选）：
 *   - mode=due|all|leech：due=今日到期（默认）/ all=全部 active（cram）/ leech=顽固卡（lapses≥阈值）。
 *   - domain=<领域>：仅取所属概念 domain = 此值的卡（与 mode 叠加）。
 *
 * 契约：{ count, cards: [{ cardId, conceptId, conceptTitle, front, back, leech }] }
 *   - count：该模式下卡片总数（未裁剪）。
 *   - cards：按遗忘风险排序、裁到每日上限（≤20）后的队列；每项含 leech:boolean（V14 新增，向后兼容）。
 *     · front = 卡片问题（cards.question），back = 卡片答案（cards.answer）。
 *     · conceptTitle = 所属概念名（concepts.name）。
 *
 * 复用 features/review/queue.ts 的 getReviewQueue（与服务端 /review 页同一查询逻辑），
 * 仅返回 JSON 而非 HTML。鉴权 getCurrentUser()，授权严格按当前 userId 过滤。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode = parseMode(url.searchParams.get('mode'));
  const domainRaw = url.searchParams.get('domain');
  const domain = domainRaw && domainRaw.trim() ? domainRaw.trim() : null;

  const { count, items } = await getReviewQueue(getDb(), user.id, { mode, domain });

  return NextResponse.json({
    count,
    cards: items.map((item) => ({
      cardId: item.id,
      conceptId: item.conceptId,
      conceptTitle: item.conceptName,
      front: item.question,
      back: item.answer,
      leech: item.leech,
    })),
  });
}
