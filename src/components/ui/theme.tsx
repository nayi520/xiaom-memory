'use client';

/**
 * 深色模式：手动开关 + 跟随系统（三态），localStorage 持久化，默认「跟随系统」。
 *
 * 与 tailwind darkMode:'class' 配套——是否加 <html class="dark"> 由这里统一决定：
 *  - theme='light' → 永远浅色
 *  - theme='dark'  → 永远深色
 *  - theme='system'→ 跟随 prefers-color-scheme，且系统切换时实时响应
 *
 * 无闪白（SSR 首屏）：真正避免 FOUC 的是 layout <head> 里的内联脚本（themeInitScript），
 * 它在 React 注水前就按 localStorage 把 .dark 与 color-scheme 落到 <html>。本 Provider
 * 注水后接管，保证后续切换、跨标签同步、系统变更都一致。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'xiaom-theme';

interface ThemeApi {
  /** 用户选择的偏好（light/dark/system）。 */
  theme: Theme;
  /** 实际生效的外观（system 解析后只会是 light/dark）。 */
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

/**
 * 注入到 <head> 的内联脚本源码：在首帧前按持久化偏好设置 <html> 的 class 与 color-scheme，
 * 杜绝深色用户刷新时的「闪白」。保持极简、自包含、容错（隐私模式读 storage 抛错也不崩）。
 */
export const themeInitScript = `(function(){try{var k='${STORAGE_KEY}';var t=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||((!t||t==='system')&&m);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 隐私模式等读不到：回退跟随系统 */
  }
  return 'system';
}

/** 把生效外观落到 <html>：class（给 tailwind）+ color-scheme（给原生控件/滚动条）。 */
function applyDark(dark: boolean) {
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 首帧用 'system' 占位，注水后 useEffect 立即用真实持久化值覆盖（DOM class 已由内联脚本就位，无闪烁）。
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  // 注水后读取持久化偏好。
  useEffect(() => {
    setThemeState(readStored());
  }, []);

  // theme 变化时：落 DOM、算 resolved。system 模式额外订阅系统变更。
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const computeAndApply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches);
      applyDark(dark);
      setResolved(dark ? 'dark' : 'light');
    };
    computeAndApply();

    if (theme === 'system') {
      mql.addEventListener('change', computeAndApply);
      return () => mql.removeEventListener('change', computeAndApply);
    }
  }, [theme]);

  // 跨标签页同步：另一个标签改了主题，这个标签跟上。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThemeState(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* 写不进去也不阻塞：本次会话内仍生效 */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** 读取/设置主题。须在 <ThemeProvider> 内使用。 */
export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  }
  return ctx;
}
