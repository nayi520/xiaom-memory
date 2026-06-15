'use client';

/**
 * 外观偏好统一来源：深浅色（手动/跟随系统三态）+ 主题色 + 字号，localStorage 持久化。
 *
 * 与 tailwind darkMode:'class' 配套——是否加 <html class="dark"> 由这里统一决定：
 *  - theme='light' → 永远浅色
 *  - theme='dark'  → 永远深色
 *  - theme='system'→ 跟随 prefers-color-scheme，且系统切换时实时响应
 *
 * 主题色 / 字号：写在 <html> 的 data-accent / data-font 上，CSS 变量（见 globals.css）据此切换；
 * 默认 accent='indigo'（历史 #4F46E5 系）、font='base'（100%）。
 *
 * 无闪白（SSR 首屏）：真正避免 FOUC 的是 layout <head> 里的内联脚本（themeInitScript），
 * 它在 React 注水前就按 localStorage 把 .dark / color-scheme / data-accent / data-font 落到 <html>。
 * 本 Provider 注水后接管，保证后续切换、跨标签同步、系统变更都一致。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';

/** 主题色预设 key（与 globals.css 的 html[data-accent=...] 选择器一一对应）。indigo 为默认，不写 data-accent。 */
export type Accent = 'indigo' | 'violet' | 'blue' | 'emerald' | 'rose' | 'amber';
/** 字号档（与 globals.css 的 --app-font-scale 对应）。base 为默认，不写 data-font。 */
export type FontScale = 'sm' | 'base' | 'lg';

const STORAGE_KEY = 'xiaom-theme';
const ACCENT_KEY = 'xiaom-accent';
const FONT_KEY = 'xiaom-font';

const ACCENTS: readonly Accent[] = ['indigo', 'violet', 'blue', 'emerald', 'rose', 'amber'];
const FONTS: readonly FontScale[] = ['sm', 'base', 'lg'];
const FONT_SCALE: Record<FontScale, number> = { sm: 0.9375, base: 1, lg: 1.0625 };

interface ThemeApi {
  /** 用户选择的深浅色偏好（light/dark/system）。 */
  theme: Theme;
  /** 实际生效的外观（system 解析后只会是 light/dark）。 */
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  /** 主题色。 */
  accent: Accent;
  setAccent: (a: Accent) => void;
  /** 字号档。 */
  fontScale: FontScale;
  setFontScale: (f: FontScale) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

/**
 * 注入到 <head> 的内联脚本源码：在首帧前按持久化偏好设置 <html> 的 class / color-scheme /
 * data-accent / data-font，杜绝深色或换色用户刷新时的「闪烁」。保持极简、自包含、容错。
 */
export const themeInitScript = `(function(){try{var e=document.documentElement;var t=localStorage.getItem('${STORAGE_KEY}');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||((!t||t==='system')&&m);e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';var a=localStorage.getItem('${ACCENT_KEY}');if(a&&a!=='indigo')e.setAttribute('data-accent',a);var f=localStorage.getItem('${FONT_KEY}');if(f&&f!=='base')e.setAttribute('data-font',f);}catch(e){}})();`;

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

function readAccent(): Accent {
  if (typeof window === 'undefined') return 'indigo';
  try {
    const v = localStorage.getItem(ACCENT_KEY) as Accent | null;
    if (v && ACCENTS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'indigo';
}

function readFont(): FontScale {
  if (typeof window === 'undefined') return 'base';
  try {
    const v = localStorage.getItem(FONT_KEY) as FontScale | null;
    if (v && FONTS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'base';
}

/** 把生效外观落到 <html>：class（给 tailwind）+ color-scheme（给原生控件/滚动条）。 */
function applyDark(dark: boolean) {
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
}

/** 默认值不写 data-* 属性（让 :root 默认变量生效），非默认才落属性。 */
function applyAttr(name: string, value: string, isDefault: boolean) {
  const el = document.documentElement;
  if (isDefault) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 首帧用默认占位，注水后 useEffect 立即用真实持久化值覆盖（DOM 已由内联脚本就位，无闪烁）。
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const [accent, setAccentState] = useState<Accent>('indigo');
  const [fontScale, setFontScaleState] = useState<FontScale>('base');

  // 注水后读取持久化偏好。
  useEffect(() => {
    setThemeState(readStored());
    setAccentState(readAccent());
    setFontScaleState(readFont());
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

  // accent / fontScale 变化时落 data 属性（默认值不写，保留 :root 缺省变量）。
  useEffect(() => {
    applyAttr('data-accent', accent, accent === 'indigo');
  }, [accent]);
  useEffect(() => {
    applyAttr('data-font', fontScale, fontScale === 'base');
  }, [fontScale]);

  // 跨标签页同步：另一个标签改了任一外观偏好，这个标签跟上。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThemeState(readStored());
      else if (e.key === ACCENT_KEY) setAccentState(readAccent());
      else if (e.key === FONT_KEY) setFontScaleState(readFont());
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

  const setAccent = useCallback((a: Accent) => {
    setAccentState(a);
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {
      /* ignore */
    }
  }, []);

  const setFontScale = useCallback((f: FontScale) => {
    setFontScaleState(f);
    try {
      localStorage.setItem(FONT_KEY, f);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolved, setTheme, accent, setAccent, fontScale, setFontScale }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/** 读取/设置外观偏好（深浅色 + 主题色 + 字号）。须在 <ThemeProvider> 内使用。 */
export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  }
  return ctx;
}
