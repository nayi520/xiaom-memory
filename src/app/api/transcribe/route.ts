import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/transcribe  { noteId }
 * 下载 note 对应音频 → OpenAI Whisper 转写 → 更新 transcript
 * 未配置 OPENAI_API_KEY 时优雅降级（音频已保存，转写待配置）
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let noteId: string | undefined;
  try {
    ({ noteId } = await request.json());
  } catch {
    /* noop */
  }
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const { data: note, error: noteError } = await supabase
    .from('notes')
    .select('*')
    .eq('id', noteId)
    .single();
  if (noteError || !note || note.type !== 'voice' || !note.media_path) {
    return NextResponse.json({ error: '记录不存在或非语音' }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 优雅降级：不报错，提示待配置
    return NextResponse.json({
      transcribed: false,
      message: '转写待配置（未设置 OPENAI_API_KEY），音频已保存',
    });
  }

  // 从 Storage 下载音频（RLS 保证只能取到自己的）
  const { data: audio, error: downloadError } = await supabase.storage
    .from('audio')
    .download(note.media_path);
  if (downloadError || !audio) {
    return NextResponse.json({ error: '音频下载失败' }, { status: 500 });
  }

  try {
    const form = new FormData();
    form.append('file', new File([audio], 'audio.webm', { type: 'audio/webm' }));
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('[transcribe] whisper error:', detail.slice(0, 500));
      return NextResponse.json({
        transcribed: false,
        message: '转写失败，音频已保存（稍后可重试）',
      });
    }

    const { text } = (await res.json()) as { text: string };

    const { error: updateError } = await supabase
      .from('notes')
      .update({ transcript: text, raw_content: text })
      .eq('id', noteId);
    if (updateError) {
      return NextResponse.json({ error: '转写结果保存失败' }, { status: 500 });
    }

    return NextResponse.json({ transcribed: true, transcript: text });
  } catch (err) {
    console.error('[transcribe] error:', err);
    return NextResponse.json({
      transcribed: false,
      message: '转写失败，音频已保存（稍后可重试）',
    });
  }
}
