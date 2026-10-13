'use client';

import dynamic from 'next/dynamic';

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false });
const AiAssistant = dynamic(() => import('@/components/AiAssistant'), { ssr: false });
// Mounted once for the whole app so a call survives navigation; it renders nothing until a rep opens it.
const DialerDockHost = dynamic(() => import('@/components/dialer/DialerDockHost'), { ssr: false });

export default function ClientLayoutAddons() {
  return (
    <>
      <CommandPalette />
      <AiAssistant />
      <DialerDockHost />
    </>
  );
}
