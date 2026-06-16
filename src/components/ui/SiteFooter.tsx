/**
 * 站点合规页脚（ICP 备案 + 版权 + 法务互链）。
 *
 * 站点 memory.nayitools.cn 部署在大陆（广州 ECS），主域 nayitools.cn 已 ICP 备案。
 * 大陆备案站点需在页面展示备案号并链接到工信部备案系统（beian.miit.gov.cn）。
 *
 * 两种形态：
 *   - 默认（full）   ：公网入口（登录页、/terms、/privacy 底部）。备案号 + 版权 +
 *                      《用户协议》/《隐私政策》互链，居中、低调、深浅色适配、移动端折行不挤。
 *   - compact        ：App 内不打扰位（桌面侧栏底部 / 设置页底部）。仅一行小字：
 *                      备案号 + 链接，不重复版权与法务链接，避免喧宾夺主。
 *
 * 备案号集中为单个常量 ICP_NO，便于日后变更。纯展示、零客户端 JS（服务端组件）。
 */

import Link from 'next/link';
import { cn } from './cn';

/** ICP 备案号（主域 nayitools.cn 已备案）。改备案号只需改这里。 */
export const ICP_NO = '粤ICP备2026063379号';
/** 工信部备案管理系统（点击备案号跳转，官方要求可核验）。 */
const ICP_QUERY_URL = 'https://beian.miit.gov.cn/';
/** 版权署名。 */
const COPYRIGHT = '© 2026 小M · Memory';

/** 备案号 → 工信部备案系统外链（两种形态共用，统一新窗 + noopener）。 */
function BeianLink({ className }: { className?: string }) {
  return (
    <a
      href={ICP_QUERY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('transition hover:text-brand', className)}
    >
      {ICP_NO}
    </a>
  );
}

export default function SiteFooter({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'compact';
  className?: string;
}) {
  // 紧凑形态：App 内一行小字（备案号 + 链接），不打扰。
  if (variant === 'compact') {
    return (
      <p
        className={cn(
          'text-center text-[11px] leading-relaxed text-zinc-300 dark:text-zinc-600',
          className
        )}
      >
        <BeianLink />
      </p>
    );
  }

  // 完整形态：公网入口底部（版权 + 法务互链 + 备案号）。
  return (
    <footer
      className={cn(
        'flex flex-col items-center gap-1.5 text-center text-xs text-zinc-400 dark:text-zinc-600',
        className
      )}
    >
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/terms" className="transition hover:text-brand">
          《用户协议》
        </Link>
        <Link href="/privacy" className="transition hover:text-brand">
          《隐私政策》
        </Link>
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>{COPYRIGHT}</span>
        <BeianLink />
      </p>
    </footer>
  );
}
