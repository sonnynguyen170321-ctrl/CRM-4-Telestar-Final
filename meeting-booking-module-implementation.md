# Meeting Booking + Meeting Outcome Module

Context: This CRM is for a BPO SDR-as-a-Service operation. Different clients may provide different external booking links, so the CRM should support configurable booking links per client and per campaign, then snapshot the exact link used when a meeting is booked.

## Goal

Build a module that supports this SDR flow:

1. Director / Floor Manager sets up one or more booking links for each client or campaign.
2. SDR opens a lead and sees the correct booking link for that lead's campaign/client.
3. SDR can copy/open the booking link and log that the link was sent.
4. Once the prospect books, SDR records the meeting date/time, owner, meeting URL, and notes.
5. CRM moves the lead to `meeting_booked`, pauses outreach sequence, logs the activity, and creates an outcome follow-up task.
6. After the meeting, SDR/manager logs the outcome: completed, no-show, cancelled, rescheduled, qualified opportunity, not qualified, etc.
7. Meeting data becomes the source for the next module: Opportunity/deal pipeline.

---

## Why use a separate `BookingLink` model?

Do not add only `bookingUrl` to `Client`. That is too limited for SDR-as-a-Service.

Use a separate `BookingLink` model because one client can have:

- One default link for all campaigns
- Different links by campaign
- Different links by geography or timezone
- Different links by AE / closer
- Different instructions or qualification rules
- Old links that should remain attached historically to past meetings

Each `Meeting` stores a snapshot of the URL and label used, so past records stay accurate even if the client later changes their Calendly/HubSpot/Microsoft Bookings link.

---

## Files to add

```text
app/
├─ meetings/
│  └─ page.tsx
├─ api/
│  ├─ booking-links/
│  │  ├─ route.ts
│  │  └─ [id]/route.ts
│  └─ meetings/
│     ├─ route.ts
│     ├─ [id]/route.ts
│     └─ [id]/outcome/route.ts

components/
├─ meetings/
│  ├─ MeetingBookingModal.tsx
│  ├─ MeetingOutcomeModal.tsx
│  ├─ MeetingStatusBadge.tsx
│  └─ BookingLinkSettingsPanel.tsx

lib/
├─ meetings/
│  ├─ bookingLinks.ts
│  ├─ meetingAccess.ts
│  └─ meetingLifecycle.ts
```

## Files to modify

```text
prisma/schema.prisma
lib/validation/schemas.ts
components/Sidebar.tsx
context/AppContext.tsx
components/DashboardShell.tsx
components/LeadDetailPanel.tsx
app/settings/page.tsx
```

---

## Prisma schema patch

Add these enums near the existing enum section:

```prisma
enum BookingLinkProvider {
  calendly
  google_calendar
  hubspot
  microsoft_bookings
  salesloft
  other
}

enum MeetingStatus {
  link_sent
  scheduled
  completed
  no_show
  cancelled
  rescheduled
}

enum MeetingOutcome {
  qualified_opportunity
  completed_not_qualified
  no_show
  cancelled
  rescheduled
  no_decision
  other
}
```

Extend `ActivityType`:

```prisma
enum ActivityType {
  email_sent
  call_made
  call_logged
  linkedin_sent
  linkedin_touch
  whatsapp_sent
  whatsapp_message
  note_added
  stage_changed
  task_completed
  task_skipped
  lead_created
  meeting_booked
  booking_link_sent
  meeting_outcome_logged
  meeting_cancelled
  meeting_rescheduled
  sequence_enrolled
  sequence_completed
  sequence_unenrolled
  email_task_completed
  lead_reassigned
}
```

Add relations:

```prisma
model User {
  // existing fields...
  createdBookingLinks   BookingLink[] @relation("BookingLinkCreator")
  sdrMeetings           Meeting[]     @relation("MeetingSdr")
  outcomeLoggedMeetings Meeting[]     @relation("MeetingOutcomeLogger")
}

model Client {
  // existing fields...
  bookingLinks BookingLink[]
  meetings     Meeting[]
}

model Campaign {
  // existing fields...
  bookingLinks BookingLink[]
  meetings     Meeting[]
}

model Lead {
  // existing fields...
  meetings Meeting[]
}

model Tenant {
  // existing fields...
  bookingLinks BookingLink[]
  meetings     Meeting[]
}
```

Add new models:

```prisma
model BookingLink {
  id                 String              @id @default(cuid())
  clientId           String
  client             Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  campaignId         String?
  campaign           Campaign?           @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  name               String
  url                String              @db.Text
  provider           BookingLinkProvider @default(other)
  ownerName          String?
  ownerEmail         String?
  timezone           String              @default("UTC")
  durationMins       Int                 @default(30)
  instructions       String?             @db.Text
  qualificationNotes String?             @db.Text
  isDefault          Boolean             @default(false)
  isActive           Boolean             @default(true)
  createdById        String?
  createdBy          User?               @relation("BookingLinkCreator", fields: [createdById], references: [id], onDelete: SetNull)
  meetings           Meeting[]
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  tenantId           String
  tenant             Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([clientId])
  @@index([campaignId])
  @@index([clientId, isDefault])
  @@index([campaignId, isDefault])
  @@index([isActive])
}

model Meeting {
  id                     String          @id @default(cuid())
  leadId                 String
  lead                   Lead            @relation(fields: [leadId], references: [id], onDelete: Cascade)
  clientId               String
  client                 Client          @relation(fields: [clientId], references: [id])
  campaignId             String
  campaign               Campaign        @relation(fields: [campaignId], references: [id])
  sdrId                  String
  sdr                    User            @relation("MeetingSdr", fields: [sdrId], references: [id])
  bookingLinkId          String?
  bookingLink            BookingLink?    @relation(fields: [bookingLinkId], references: [id], onDelete: SetNull)
  bookingLinkUrlSnapshot String?         @db.Text
  bookingLinkNameSnapshot String?
  sourceChannel          Channel?
  status                 MeetingStatus   @default(scheduled)
  title                  String
  scheduledAt            DateTime?
  durationMins           Int             @default(30)
  timezone               String?
  meetingUrl             String?         @db.Text
  prospectName           String?
  prospectEmail          String?
  clientOwnerName        String?
  clientOwnerEmail       String?
  externalEventId        String?
  externalEventUrl       String?         @db.Text
  outcome                MeetingOutcome?
  outcomeNotes           String?         @db.Text
  painPoints             String?         @db.Text
  nextStep               String?         @db.Text
  outcomeLoggedById      String?
  outcomeLoggedBy        User?           @relation("MeetingOutcomeLogger", fields: [outcomeLoggedById], references: [id], onDelete: SetNull)
  outcomeLoggedAt        DateTime?
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt
  tenantId               String
  tenant                 Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([leadId])
  @@index([clientId])
  @@index([campaignId])
  @@index([sdrId])
  @@index([status])
  @@index([scheduledAt])
  @@index([tenantId, status, scheduledAt])
}
```

Run:

```bash
npm run db:migrate -- --name meeting_booking_module
npm run db:generate
```

---

## Validation schemas to add in `lib/validation/schemas.ts`

```ts
export const bookingLinkProvider = z.enum([
  'calendly',
  'google_calendar',
  'hubspot',
  'microsoft_bookings',
  'salesloft',
  'other',
]);

export const meetingStatus = z.enum([
  'link_sent',
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
]);

export const meetingOutcome = z.enum([
  'qualified_opportunity',
  'completed_not_qualified',
  'no_show',
  'cancelled',
  'rescheduled',
  'no_decision',
  'other',
]);

export const createBookingLinkSchema = z.object({
  clientId: id,
  campaignId: id.nullish().optional(),
  name: z.string().min(1).max(160),
  url: z.string().url().max(2000),
  provider: bookingLinkProvider.optional(),
  ownerName: nullableShortText.optional(),
  ownerEmail: z.string().email().max(320).nullish().optional(),
  timezone: z.string().min(1).max(80).optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  instructions: nullableLongText.optional(),
  qualificationNotes: nullableLongText.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateBookingLinkSchema = createBookingLinkSchema.partial().omit({ clientId: true });

export const createMeetingSchema = z.object({
  leadId: id,
  bookingLinkId: id.nullish().optional(),
  sourceChannel: channel.nullish().optional(),
  status: z.enum(['link_sent', 'scheduled']).optional(),
  title: z.string().min(1).max(240).optional(),
  scheduledAt: isoDate.nullish().optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  timezone: z.string().max(80).nullish().optional(),
  meetingUrl: z.string().url().max(2000).nullish().optional(),
  clientOwnerName: nullableShortText.optional(),
  clientOwnerEmail: z.string().email().max(320).nullish().optional(),
});

export const updateMeetingSchema = z.object({
  status: meetingStatus.optional(),
  scheduledAt: isoDate.nullish().optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  timezone: z.string().max(80).nullish().optional(),
  meetingUrl: z.string().url().max(2000).nullish().optional(),
  clientOwnerName: nullableShortText.optional(),
  clientOwnerEmail: z.string().email().max(320).nullish().optional(),
});

export const logMeetingOutcomeSchema = z.object({
  status: z.enum(['completed', 'no_show', 'cancelled', 'rescheduled']),
  outcome: meetingOutcome,
  outcomeNotes: nullableLongText.optional(),
  painPoints: nullableLongText.optional(),
  nextStep: nullableLongText.optional(),
  followUpAt: isoDate.nullish().optional(),
});
```

---

## API behavior

### `POST /api/booking-links`

Manager creates client/campaign booking links.

Rules:

- `director` and `floor_manager` can create/update/delete.
- `team_lead`, `sdr`, and `leadgen` can read links only for campaigns/leads they can access.
- If `isDefault=true`, unset other defaults for the same campaign first; if no campaign, unset other client-level defaults.

### `POST /api/meetings`

Creates either a `link_sent` record or a `scheduled` meeting.

Rules:

- User must pass `canAccessLead`.
- If `bookingLinkId` is not supplied, resolve the default link in this order:
  1. Active default booking link for the campaign
  2. Active default booking link for the client
  3. Any active booking link for the campaign
  4. Any active booking link for the client
- If `status=scheduled`, `scheduledAt` is required.
- On scheduled meeting:
  - Set lead stage to `meeting_booked`
  - Pause sequence if active
  - Create `meeting_booked` activity
  - Create reminder/task to log outcome after meeting
  - Notify SDR/owner

### `POST /api/meetings/[id]/outcome`

Logs the result after the meeting.

Rules:

- User must pass `canAccessLead` for that meeting's lead.
- Outcome is required.
- If no-show, automatically create a follow-up task.
- If qualified opportunity, keep data ready for the next module: Opportunity/deal pipeline.

---

## Service logic: booking link resolver

Create `lib/meetings/bookingLinks.ts`:

```ts
import { prisma } from '@/lib/prisma';

export async function resolveBookingLink(input: {
  tenantId: string;
  clientId: string;
  campaignId: string;
  bookingLinkId?: string | null;
}) {
  const { tenantId, clientId, campaignId, bookingLinkId } = input;

  if (bookingLinkId) {
    return prisma.bookingLink.findFirst({
      where: {
        id: bookingLinkId,
        tenantId,
        clientId,
        isActive: true,
        OR: [{ campaignId }, { campaignId: null }],
      },
    });
  }

  return prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  }) ?? prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId: null, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  }) ?? prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  }) ?? prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId: null, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}
```

---

## Recommended first UI version

### 1. Settings → Booking Links

Add a section under Campaigns:

```text
Booking Links
├─ Client
├─ Campaign optional override
├─ Link name
├─ Provider
├─ URL
├─ Owner name/email
├─ Timezone
├─ Duration
├─ Instructions
├─ Qualification notes
├─ Default toggle
└─ Active toggle
```

### 2. Lead Detail → Book Meeting button

Add button to lead detail panel:

```text
Book Meeting
├─ Shows resolved client/campaign booking link
├─ Copy link
├─ Open link
├─ Mark link sent
├─ Mark meeting scheduled
└─ Add scheduled date/time and meeting URL
```

### 3. Meetings page

Add `/meetings` page with:

```text
Meetings Dashboard
├─ KPI cards
│  ├─ Links sent
│  ├─ Scheduled
│  ├─ Completed
│  ├─ No-shows
│  └─ Outcome pending
├─ Filters
│  ├─ Client
│  ├─ Campaign
│  ├─ SDR
│  ├─ Status
│  └─ Date range
└─ Table
   ├─ Lead
   ├─ Company
   ├─ Client
   ├─ Campaign
   ├─ SDR
   ├─ Scheduled time
   ├─ Booking owner
   ├─ Status
   ├─ Outcome
   └─ Actions
```

---

## Sidebar change

In `components/Sidebar.tsx`, import a calendar icon:

```ts
import { CalendarDays } from 'lucide-react';
```

Add to normal users after Inbox or Leads:

```ts
{ name: 'Meetings', href: '/meetings', icon: CalendarDays },
```

Keep Leadgen users focused unless they need to see meetings later.

---

## Business workflow for your BPO SDR team

Use this workflow operationally:

```text
Client onboarding
→ add client
→ add campaign
→ add booking link(s)
→ add instructions/qualification rules
→ assign SDRs
→ import leads
→ outreach
→ prospect interested
→ SDR sends correct booking link
→ meeting scheduled
→ CRM moves lead to meeting_booked
→ SDR/manager logs outcome
→ qualified outcomes feed opportunity pipeline
```

---

## Done criteria for item 1

This module is done when:

- [ ] Admin can create booking links per client and campaign.
- [ ] SDR can see the right booking link from a lead.
- [ ] SDR can log `link_sent` without moving lead to `meeting_booked`.
- [ ] SDR can schedule a meeting and move lead to `meeting_booked`.
- [ ] Sequence pauses when a meeting is scheduled.
- [ ] Meeting outcome task is created automatically.
- [ ] Outcome can be logged as completed, no-show, cancelled, or rescheduled.
- [ ] Meetings dashboard shows client, campaign, SDR, status, and outcome.
- [ ] Historical meetings keep the original booking link snapshot.
- [ ] Tenant and role scoping are enforced in every API.

