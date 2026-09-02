// O5s / O7: IMAP UID high-water mark logic. Each mailbox tracks the highest UID
// processed; the poller fetches only UIDs above it, in order, so inbound mail is
// ingested exactly once (no reprocessing on the next poll). Pure.

export type ImapWatermarkState = {
  lastSeenUid: number; // 0 when never polled
};

/** UIDs to fetch this poll: those strictly above the watermark, ascending, capped. */
export function nextUidsToFetch(
  state: ImapWatermarkState,
  availableUids: readonly number[],
  maxBatch = 200
): number[] {
  const lastSeen = Number.isFinite(state.lastSeenUid) ? state.lastSeenUid : 0;
  return [...availableUids]
    .filter((uid) => Number.isInteger(uid) && uid > lastSeen)
    .sort((a, b) => a - b)
    .slice(0, maxBatch);
}

/** Advance the watermark to the highest UID just processed (never moves backward). */
export function advanceWatermark(state: ImapWatermarkState, processedUids: readonly number[]): ImapWatermarkState {
  const max = processedUids.reduce((m, uid) => (uid > m ? uid : m), state.lastSeenUid);
  return { lastSeenUid: Math.max(state.lastSeenUid, max) };
}
