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
        // ——「内容最大宽度」统一刻度（跨页一致、有意图，避免每页各拍一个数）——
        // 与 PageShell 的三档（content / wide / full）配套，外加单列阅读专用 reading。
        // 大屏（≥1536 2xl）逐级放大后封顶并居中（mx-auto），两侧留白对称、不边到边拉伸。
        content: '40rem', // 640px，移动 + 桌面单列基准（向后兼容旧引用）
        reading: '46rem', // 736px，单列长文/对话最舒适阅读宽度（问答 / 复习 / 概念&记录详情）
        // 注：纯正文行长沿用 Tailwind 内置 max-w-prose（65ch，按字数控制），此处不覆盖以免影响既有用法。
        'content-lg': '50rem', // 800px，content 档在桌面（lg+）的稳定宽度
        'content-2xl': '54rem', // 864px，content 档在超宽屏（2xl）的封顶宽度
        'wide-lg': '64rem', // 1024px，wide 档在桌面（lg+）
        'wide-xl': '72rem', // 1152px，wide 档在大屏（xl）
        'wide-2xl': '80rem', // 1280px，wide 档在超宽屏（2xl）封顶
        shell: '72rem', // 1152px，宽屏外壳（侧栏 + 内容，向后兼容）
        'app-2xl': '100rem', // 1600px，自管布局页（知识库 full 档）在超宽屏的整体封顶，居中留白
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
        // 移动端底部 sheet 滑入（V19）：从屏幕底部上移到位。
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        // 复习达成庆祝（V20）：纸屑下落 + 旋转 + 渐隐；x 漂移/旋角由每片 CSS 变量提供。
        'confetti-fall': {
          '0%': { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: '1' },
          '100%': {
            transform:
              'translate3d(var(--confetti-dx, 0), var(--confetti-dy, 70vh), 0) rotate(var(--confetti-rot, 540deg))',
            opacity: '0',
          },
        },
        // 达成对勾脉冲（V20）：轻微放大回弹，给「达标」一个即时反馈。
        'celebrate-pop': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '55%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s var(--ease-smooth, ease) both',
        'fade-in-up': 'fade-in-up 0.3s var(--ease-smooth, ease) both',
        'scale-in': 'scale-in 0.18s var(--ease-smooth, ease) both',
        'flip-in': 'flip-in 0.22s var(--ease-smooth, ease) both',
        'sheet-up': 'sheet-up 0.28s var(--ease-smooth, ease) both',
        // both + forwards：动画结束停在末态（纸屑保持透明，避免回闪）。
        'confetti-fall': 'confetti-fall var(--confetti-dur, 1.6s) var(--ease-smooth, ease-out) var(--confetti-delay, 0s) forwards',
        'celebrate-pop': 'celebrate-pop 0.45s var(--ease-smooth, ease) both',
      },
    },
  },
  plugins: [],
};

export default config;
