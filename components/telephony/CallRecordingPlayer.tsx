'use client';

import { useState } from 'react';

/**
 * "Play recording" on a call in the lead timeline. The server only sends a call id here when the
 * viewer may hear it (app/api/activities), and the playback route decides again; if it answers with
 * anything but audio, the control disappears rather than showing an error.
 */
export default function CallRecordingPlayer({ callId }: { callId: string }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;
  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="mt-2 text-[11px] font-semibold text-brand-red hover:underline"
      >
        Play recording
      </button>
    );
  }
  return (
    <audio
      className="mt-2 w-full h-8"
      controls
      autoPlay
      preload="none"
      src={`/api/telephony/calls/${encodeURIComponent(callId)}/recording`}
      onError={() => setFailed(true)}
    />
  );
}
