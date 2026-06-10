'use client';

import { useEffect } from 'react';

export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW 注册失败不影响使用
      });
    }
  }, []);
  return null;
}
