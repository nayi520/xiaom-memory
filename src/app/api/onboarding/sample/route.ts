import { NextResponse } from 'next/server';
import { and, eq, isNull, like } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/sample —— 新手引导「一键添加示例笔记」（V12）
 *
 * 为刚进来的新用户创建 2–3 条**清晰标注为示例、可随时删除**的文本记录，让首页/时间线不再对着空屏，
 * 并直观演示小M的三步：捕获 → AI 自动整理 → 间隔复习 / 问小M。
 *
 * 设计：
 *  - 复用既有 notes 表与软删机制，记录与普通文本记录同构（type='text'、status='inbox'），
 *    因此能被 AI 流水线正常整理、能在最近记录 / 时间线展示、能用既有删除流程删除。
 *  - 每条以「[示例]」开头并在 why_important 注明可删除，用户一眼能辨识；不强制、用户自选触发。
 *  - 幂等：若该用户已存在「[示例]」开头的记录，则不再重复创建（防重复点击 / 多设备各点一次）。
 *
 * 鉴权 getCurrentUser()；授权应用层（显式按 user.id 落 / 查）。
 * 返回 { ok, created }：created 为本次新建条数（已存在示例时为 0）。
 */

/** 示例标记前缀：用于辨识 + 幂等去重（用户删除后可再次添加）。 */
const SAMPLE_PREFIX = '[示例]';
const SAMPLE_WHY = '这是小M为你准备的示例，看完可随时删除';

/** 三条示例文本：分别点题「捕获想法」「剪藏要点」「等待整理」，覆盖核心心智模型。 */
const SAMPLE_NOTES: { raw_content: string }[] = [
  {
    raw_content: `${SAMPLE_PREFIX} 间隔重复（spaced repetition）是把复习安排在「快要忘记」的时间点，用越来越长的间隔巩固记忆。小M 会按这个规律，在该复习时提醒你。`,
  },
  {
    raw_content: `${SAMPLE_PREFIX} 记笔记的关键不是抄下来，而是用自己的话复述一遍——这个动作叫「精细加工」，能显著加深理解和记忆。`,
  },
  {
    raw_content: `${SAMPLE_PREFIX} 随手记下任何想法、读到的要点或一段灵感，小M 会在每晚自动整理成概念、归入知识库，并生成复习卡片。试着删掉这几条示例，记下你自己的第一条吧。`,
  },
];

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const db = getDb();

  // 幂等：已存在未删的示例记录则不重复创建（按本人 + raw_content 以示例前缀开头判断）。
  try {
    const existing = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.userId, user.id),
          isNull(notes.deletedAt),
          like(notes.rawContent, `${SAMPLE_PREFIX}%`)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, created: 0 });
    }
  } catch (err) {
    console.error('[onboarding/sample] 查重失败：', err);
    // 查重失败不阻断：继续尝试创建（最坏情况多一组示例，用户可删）。
  }

  try {
    const rows = await db
      .insert(notes)
      .values(
        SAMPLE_NOTES.map((s) => ({
          userId: user.id,
          type: 'text' as const,
          rawContent: s.raw_content,
          whyImportant: SAMPLE_WHY,
          status: 'inbox' as const,
        }))
      )
      .returning({ id: notes.id });
    return NextResponse.json({ ok: true, created: rows.length });
  } catch (err) {
    console.error('[onboarding/sample] 创建失败：', err);
    return NextResponse.json({ error: '示例创建失败' }, { status: 500 });
  }
}
