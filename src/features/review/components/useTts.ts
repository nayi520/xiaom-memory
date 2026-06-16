'use client';

/**
 * 复习朗读（TTS）—— 浏览器 SpeechSynthesis 封装（V14，纯客户端）
 *
 * 职责：
 *   - supported：当前环境是否支持 Web Speech 合成（SSR / 老浏览器为 false）。
 *   - enabled：开关，持久化到 localStorage（跨页面/会话保留）；默认关（尊重静音，不主动出声）。
 *   - speak(text)：朗读一段文本（中文 voice 优先），开关关闭时静默忽略；说话前先取消上一段。
 *   - cancel()：立即停止朗读（翻面/切卡/卸载时调用，避免串音）。
 *
 * 注意：不自动朗读，只有用户点朗读按钮 / 已开启开关时才发声；组件卸载时 cancel，避免离开复习还在念。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'xiaom.review.tts';

/** 从已加载的语音列表里挑一个中文 voice（zh / cmn），挑不到返回 null（用默认嗓音）。 */
function pickChineseVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const zh = voices.find((v) => /^zh|cmn/i.test(v.lang));
  return zh ?? null;
}

export interface TtsController {
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  speak: (text: string) => void;
  cancel: () => void;
}

export function useTts(): TtsController {
  // SSR 安全：仅在浏览器判定支持。
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    // 读持久化开关。
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* localStorage 不可用时保持默认关 */
    }

    // 语音列表异步加载（首次可能为空，监听 voiceschanged 再取）。
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      // 卸载时停止任何朗读，避免离开复习页仍在念。
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* 忽略 */
      }
    };
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* 忽略持久化失败 */
    }
    // 关闭时立刻静音。
    if (!on && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const cancel = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!enabled) return; // 开关关闭：尊重静音，不出声。
      const trimmed = text?.trim();
      if (!trimmed) return;
      try {
        window.speechSynthesis.cancel(); // 先打断上一段，避免叠音。
        const u = new SpeechSynthesisUtterance(trimmed);
        const voice = pickChineseVoice(voicesRef.current);
        if (voice) u.voice = voice;
        u.lang = voice?.lang ?? 'zh-CN';
        window.speechSynthesis.speak(u);
      } catch {
        /* 合成失败静默降级，不打扰复习 */
      }
    },
    [enabled]
  );

  return { supported, enabled, setEnabled, speak, cancel };
}
