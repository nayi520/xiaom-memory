import type { Config } from 'tailwindcss';

/**
 * 设计 token 中心。颜色用 CSS 变量驱动（见 globals.css 的 :root / .dark-vars），
 * 以便深浅色一处定义、组件层只引用语义名（surface / border / muted / brand…）。
 * 仍保留 zinc 直用习惯，但新组件优先用这里的语义 token，降低重复与漂移。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 品牌色由 CSS 变量驱动（见 globals.css 的 --brand-xxx），便于「外观 · 主题色」整组切换。
        // rgb(var(--x) / <alpha-value>) 让 bg-brand/10、ring-brand/40 等透明度档照常工作。
        brand: {
          DEFAULT: 'rgb(var(--brand-600) / <alpha-value>)',
          dark: 'rgb(var(--brand-700) / <alpha-value>)',
          light: 'rgb(var(--brand-50) / <alpha-value>)',
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
      },
      borderRadius: {
        // 统一圆角节奏
        card: '1rem', // 16px，卡片/容器
        field: '0.75rem', // 12px，输入/按钮
        pill: '9999px',
      },
      boxShadow: {
        // 柔和、有层次的阴影 token（替代到处散落的 shadow-sm / shadow-lg）
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
        pop: '0 8px 30px -6px rgb(0 0 0 / 0.12)',
        focus: '0 0 0 3px rgb(var(--brand-600) / 0.18)',
      },
      maxWidth: {
        content: '40rem', // 640px，主内容阅读宽度（移动 + 桌面共用，单列阅读最舒适）
        shell: '72rem', // 1152px，宽屏外壳（侧栏 + 内容）
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'flip-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s var(--ease-smooth, ease) both',
        'fade-in-up': 'fade-in-up 0.3s var(--ease-smooth, ease) both',
        'scale-in': 'scale-in 0.18s var(--ease-smooth, ease) both',
        'flip-in': 'flip-in 0.22s var(--ease-smooth, ease) both',
      },
    },
  },
  plugins: [],
};

export default config;
