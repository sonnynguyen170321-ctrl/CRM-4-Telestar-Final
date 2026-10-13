'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import { dialerDock, isDialerHiddenPath, isDialerShortcut } from '@/lib/telephony/dialerDock';

import { useDialerDock } from './useDialerDock';
import { useDialerStatus } from './useDialerStatus';

// The dock pulls in the Telnyx client; it loads only when a rep opens it.
const DockedDialer = dynamic(() => import('./DockedDialer'), { ssr: false });

function ActiveHost() {
  const dock = useDialerDock();
  const { status } = useDialerStatus();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isDialerShortcut(event) || status !== 'enabled') return;
      event.preventDefault();
      dialerDock.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status]);

  return dock.open ? <DockedDialer /> : null;
}

export default function DialerDockHost() {
  const pathname = usePathname();
  if (isDialerHiddenPath(pathname)) return null;
  return <ActiveHost />;
}
