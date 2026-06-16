'use client';

/**
 * 新手引导编排器（V12）——全局挂载（根 layout），按状态依次展示：欢迎弹窗 → 产品导览。
 *
 * 触发条件（全部满足才展示）：
 *  - 非鉴权/法务等「裸页」（/login、/auth、/terms、/privacy 不打扰）；
 *  - onboarded 为 false（首次；或从设置页「重看引导」重新触发）。
 *
 * 流程：phase=needed → 先 WelcomeModal；用户「开始使用」→ 进入 ProductTour；导览走完/跳过 → complete()
 *   写 onboarded=true 并落本地缓存，确保只首展一次。任一步关闭都视为看过（complete）。
 *
 * 仅客户端、零额外依赖，复用既有 /api/settings 持久化。
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useOnboarding } from './store';
import WelcomeModal from './components/WelcomeModal';
import ProductTour from './components/ProductTour';

type Stage = 'welcome' | 'tour' | 'closed';

export default function OnboardingProvider() {
  const pathname = usePathname();
  const { phase, complete } = useOnboarding();
  const [stage, setStage] = useState<Stage>('welcome');

  // 引导需要展示时（首次 / 重看），把内部 stage 复位到欢迎。
  useEffect(() => {
    if (phase === 'needed') setStage('welcome');
  }, [phase]);

  // 裸页不挂载（登录/法务页是独立居中布局，且无侧栏/底栏锚点供导览定位）。
  const bare =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy');

  if (bare || phase !== 'needed') return null;

  if (stage === 'welcome') {
    return <WelcomeModal onDone={() => setStage('tour')} />;
  }
  if (stage === 'tour') {
    return (
      <ProductTour
        onDone={() => {
          setStage('closed');
          complete();
        }}
      />
    );
  }
  return null;
}
