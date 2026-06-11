/**
 * DigestStore 的 Supabase 实现（service role，仅服务端使用）
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Note } from '@/lib/types';
import type {
  CorrectionRow,
  DigestStore,
  MatchedConcept,
  NewCard,
} from './pipeline';

function throwIf(error: { message: string } | null, ctx: string): void {
  if (error) throw new Error(`${ctx}：${error.message}`);
}

export function createSupabaseDigestStore(supabase: SupabaseClient): DigestStore {
  return {
    async listUserIdsWithInbox(fromIso, toIso) {
      const { data, error } = await supabase
        .from('notes')
        .select('user_id')
        .eq('status', 'inbox')
        .is('deleted_at', null)
        .gte('created_at', fromIso)
        .lt('created_at', toIso);
      throwIf(error, '查询 inbox 用户失败');
      return Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
    },

    async listInboxNotes(userId, fromIso, toIso) {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'inbox')
        .is('deleted_at', null)
        .gte('created_at', fromIso)
        .lt('created_at', toIso)
        .order('created_at', { ascending: true });
      throwIf(error, '查询 inbox notes 失败');
      return (data ?? []) as Note[];
    },

    async getDomainsTopics(userId) {
      const { data, error } = await supabase
        .from('concepts')
        .select('domain, topic')
        .eq('user_id', userId)
        .not('domain', 'is', null);
      throwIf(error, '查询类目体系失败');
      const map: Record<string, string[]> = {};
      for (const row of data ?? []) {
        const domain = row.domain as string;
        const topic = row.topic as string | null;
        if (!map[domain]) map[domain] = [];
        if (topic && !map[domain].includes(topic)) map[domain].push(topic);
      }
      return map;
    },

    async getRecentCorrections(userId, limit) {
      const { data, error } = await supabase
        .from('corrections')
        .select('target_type, field, old_value, new_value')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      throwIf(error, '查询修正记录失败');
      return (data ?? []) as CorrectionRow[];
    },

    async updateNote(noteId, patch) {
      const { error } = await supabase.from('notes').update(patch).eq('id', noteId);
      throwIf(error, `更新 note ${noteId} 失败`);
    },

    async insertConcept(userId, concept) {
      const { data, error } = await supabase
        .from('concepts')
        .insert({
          user_id: userId,
          name: concept.name,
          summary: concept.summary,
          domain: concept.domain,
          topic: concept.topic,
        })
        .select('id')
        .single();
      throwIf(error, '新建概念失败');
      return data!.id as string;
    },

    async setConceptEmbedding(conceptId, embedding) {
      const { error } = await supabase
        .from('concepts')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', conceptId);
      throwIf(error, `写入概念 embedding 失败（${conceptId}）`);
    },

    async linkNoteConcept(noteId, conceptId) {
      const { error } = await supabase
        .from('note_concepts')
        .upsert({ note_id: noteId, concept_id: conceptId }, { ignoreDuplicates: true });
      throwIf(error, 'note_concepts 关联失败');
    },

    async insertCards(conceptId, cards: NewCard[], fsrsState) {
      const { error } = await supabase.from('cards').insert(
        cards.map((c) => ({
          concept_id: conceptId,
          question: c.question,
          answer: c.answer,
          fsrs_state: fsrsState,
        }))
      );
      throwIf(error, '写入卡片失败');
    },

    async ensureTags(userId, noteId, tags) {
      const names = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
      if (names.length === 0) return;
      const { data, error } = await supabase
        .from('tags')
        .upsert(
          names.map((name) => ({ user_id: userId, name })),
          { onConflict: 'user_id,name', ignoreDuplicates: false }
        )
        .select('id, name');
      throwIf(error, '标签 upsert 失败');
      const { error: linkError } = await supabase.from('note_tags').upsert(
        (data ?? []).map((t) => ({ note_id: noteId, tag_id: t.id })),
        { ignoreDuplicates: true }
      );
      throwIf(linkError, 'note_tags 关联失败');
    },

    async matchConcepts(userId, embedding, threshold, limit, excludeIds) {
      const { data, error } = await supabase.rpc('match_concepts', {
        p_user_id: userId,
        p_embedding: JSON.stringify(embedding),
        p_threshold: threshold,
        p_limit: limit,
        p_exclude: excludeIds,
      });
      throwIf(error, 'match_concepts 检索失败');
      return (data ?? []) as MatchedConcept[];
    },

    async insertConceptLink(conceptA, conceptB, relationType, reason) {
      const { error } = await supabase.from('concept_links').upsert(
        {
          concept_a: conceptA,
          concept_b: conceptB,
          relation_type: relationType,
          reason,
        },
        { ignoreDuplicates: true }
      );
      throwIf(error, 'concept_links 写入失败');
    },

    async saveDailyDigest(userId, period, contentMd) {
      const { error } = await supabase.from('digests').upsert(
        { user_id: userId, type: 'daily', period, content_md: contentMd },
        { onConflict: 'user_id,type,period' }
      );
      throwIf(error, '日报写入失败');
    },
  };
}
