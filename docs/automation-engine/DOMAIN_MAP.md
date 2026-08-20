---
classification: CURRENT_REFERENCE
note: Automation domain map.
---

# Automation Engine — Domain Map

> Architecture contract: every mutation path across the automation domain.

## 1. SequenceEnrollment Mutation Paths

| Caller | Action | File |
|--------|--------|------|
| `handleEnroll` | CREATE enrollment (status=active, currentStep=1) | `workers/sequence.ts:66` |
| `handleEnroll` | UPDATE prior active → unenrolled | `workers/sequence.ts:60` |
| `handleAdvance` | UPDATE currentStep, status=completed | `workers/sequence.ts:143-153` |
| `handlePause` | UPDATE status=paused | `workers/sequence.ts:171` |
| `handleUnenroll` | UPDATE status=unenrolled | `workers/sequence.ts:182` |
| `advanceSequence` | updateMany status=completed (final step) | `lib/sequences/engine.ts:110` |
| `advanceSequence` | updateMany currentStep | `lib/sequences/engine.ts:142` |
| `pauseSequence` | updateMany status=paused | `lib/sequences/engine.ts:182` |
| `pauseSequencesBulk` | updateMany status=paused (batch) | `lib/sequences/engine.ts:251` |
| `unenrollLead` | updateMany status=unenrolled | `lib/sequences/engine.ts:282` |

## 2. Lead.sequence* Mutation Paths

| Caller | Fields Changed | File |
|--------|---------------|------|
| `handleEnroll` | sequenceId, sequenceStep=1, sequenceStatus=active | `workers/sequence.ts:89-95` |
| `advanceSequence` | sequenceStep (increment) | `lib/sequences/engine.ts:137-140` |
| `advanceSequence` | sequenceId=null, sequenceStep=null, sequenceStatus=null (complete) | `lib/sequences/engine.ts:106-108` |
| `pauseSequence` | sequenceStatus=paused | `lib/sequences/engine.ts:177-179` |
| `pauseSequencesBulk` | sequenceStatus=paused | `lib/sequences/engine.ts:239-242` |
| `unenrollLead` | sequenceId=null, sequenceStep=null, sequenceStatus=null | `lib/sequences/engine.ts:274-276` |

## 3. Task Mutation Paths

| Caller | Action | File |
|--------|--------|------|
| `createTaskForStep` | CREATE pending task for sequence step | `lib/sequences/engine.ts:34-46` |
| `handleExecuteTask` | UPDATE lockedAt (CAS) | `workers/sequence.ts:290-294` |
| `handleExecuteTask` | UPDATE status=completed | `workers/sequence.ts:339-342` |
| `pauseSequence` | updateMany pending→skipped | `lib/sequences/engine.ts:187-190` |
| `pauseSequencesBulk` | updateMany pending→skipped (batch) | `lib/sequences/engine.ts:245-248` |
| `unenrollLead` | updateMany pending→skipped | `lib/sequences/engine.ts:278-280` |
| `handleApplyReply` | CREATE urgent manual follow-up task | `workers/sync.ts:248-258` |
| `repairOrphanTasks` | UPDATE pending→skipped (orphan) | `workers/maintenance.ts:26-28` |
| `repairMissingDelayed` | UPDATE lockedAt (re-lock) | `workers/maintenance.ts:115-118` |
| `repairReassignmentDrift` | UPDATE userId (re-assign) | `workers/maintenance.ts:137-139` |
| `sequence-engine cron` | UPDATE lockedAt, status=completed (direct send) | `app/api/cron/sequence-engine/route.ts:153-181` |

## 4. OutboundMessage Mutation Paths

| Caller | Action | File |
|--------|--------|------|
| `createOutboundMessage` | UPSERT (idempotent intent) | `lib/workflows/email.ts:34-48` |
| `handleEmailSend` | updateMany pending/failed→sending (CAS claim) | `workers/email.ts:159-167` |
| `handleEmailSend` | UPDATE status=sent + providerMessageId | `workers/email.ts:355-362` |
| `handleEmailSend` | UPDATE status=failed (suppressed/blocked/quota) | `workers/email.ts:186-228` |
| `markReconciliationRequired` | UPDATE status=reconciliation_required | `workers/email.ts:97-105` |
| `handleApplyReply` | UPDATE repliedAt | `workers/sync.ts:211-214` |
| `handleApplyBounce` | UPDATE status=bounced, bouncedAt | `workers/sync.ts:293-296` |
| `repairStaleSending` | UPDATE sending→sent or →reconciliation | `workers/maintenance.ts:59-76` |
| `reconcileAmbiguousSends` | UPDATE →sent or →permanently_failed | `workers/maintenance.ts:266-301` |

## 5. EmailService.fromAccount() Direct Send Paths

| Location | Bypasses Pipeline? | Notes |
|----------|-------------------|-------|
| `workers/email.ts:326` | No — uses OutboundMessage | ✅ Correct path |
| `workers/sync.ts:54` | N/A — inbox fetch, not send | ✅ Correct |
| `app/api/cron/sequence-engine/route.ts:161` | **YES** — direct send, no OutboundMessage | ⚠️ Phase 8 target |

## 6. BullMQ Enqueue Paths

| Caller | Job Type | File |
|--------|---------|------|
| `createTaskForStep` | SEQUENCE_EXECUTE_TASK (delayed) | `lib/sequences/engine.ts:59-63` |
| `enqueueEmailSendWorkflow` | EMAIL_SEND | `lib/workflows/email.ts:54-56` |
| `enqueueEmailSyncWorkflow` | EMAIL_SYNC | `lib/workflows/email.ts:61-63` |
| `enqueueImmediate` (Run Now) | SEQUENCE_EXECUTE_TASK (delay=0) | `lib/bullmq/enqueue.ts:122-161` |
| Sequence workflows | SEQUENCE_ENROLL/ADVANCE/PAUSE/UNENROLL/REBUILD | `lib/workflows/sequence.ts` |

## 7. Reply/Bounce CRM Integration

### Reply Flow (preserve as-is)
```
handleApplyReply (workers/sync.ts:190-271)
├─ Lead.stage → replied
├─ Lead.emailReplyCount++
├─ OutboundMessage.repliedAt
├─ pauseSequence() → enrollment paused, tasks skipped
├─ Activity: stage_changed
├─ Activity: email_replied
├─ Task: urgent manual follow-up
└─ Notification: lead_replied
```

### Bounce Flow (preserve as-is)
```
handleApplyBounce (workers/sync.ts:273-352)
├─ OutboundMessage.status → bounced
├─ Activity: email_bounced
├─ Hard bounce:
│   ├─ Lead.emailInvalid = true
│   ├─ Lead.tags += 'invalid-email'
│   └─ SuppressionEntry created
├─ pauseSequence() → enrollment paused, tasks skipped
└─ Notification: email_bounced
```

## 8. Current Gaps (to be addressed by phases)

| Gap | Phase |
|-----|-------|
| No central eligibility engine — inline checks in handleExecuteTask | 4 |
| No timezone-aware scheduling — uses server local time | 2 |
| No send window support | 2, 3 |
| No deterministic jitter | 2 |
| Quota exhaustion → permanent failure | 6 |
| repairMissingDelayed doesn't re-enqueue | 7 |
| Cron route bypasses OutboundMessage pipeline | 8 |
| A/B selection uses Math.random() | 5 |
| SequenceEnrollment has no nextActionAt/pausedReason | 3 |
| No DEFER vs BLOCK distinction | 4 |
