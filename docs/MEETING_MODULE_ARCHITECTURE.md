# Meeting Booking Module — System Architecture & Workflow Reference

> **Quick Reference**: This document contains full system architecture diagrams, data models, state machines, and operational flows for the Meeting Booking Module.

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph UI["Frontend UI Layer (Next.js 16 / React 19)"]
        Dashboard["/meetings<br/>(Meetings Dashboard & KPIs)"]
        LeadDetail["LeadDetailPanel<br/>(Book Meeting & History)"]
        Settings["/settings<br/>(Booking Links Tab)"]
        Modals["Modals<br/>(Booking, Outcome, Links)"]
    end

    subgraph API["API Routes Layer (/app/api)"]
        APIMeetings["/api/meetings<br/>GET / POST"]
        APIMeetingId["/api/meetings/[id]<br/>GET / PATCH"]
        APIOutcome["/api/meetings/[id]/outcome<br/>POST"]
        APIBookingLinks["/api/booking-links<br/>GET / POST / PATCH / DELETE"]
    end

    subgraph CoreServices["Domain & Service Logic (/lib)"]
        Resolver["bookingLinks.ts<br/>(Waterfall Link Resolver)"]
        Lifecycle["meetingLifecycle.ts<br/>(Booking & Outcome Engine)"]
        Access["meetingAccess.ts<br/>(Role & Tenant Scoping)"]
        SeqEngine["sequences/engine.ts<br/>(Auto Pause / Advance)"]
    end

    subgraph Storage["Data & Infrastructure"]
        DB[(PostgreSQL / Prisma ORM)]
        Redis[(Redis / BullMQ Jobs)]
    end

    Dashboard --> APIMeetings
    LeadDetail --> APIMeetings
    LeadDetail --> APIOutcome
    Settings --> APIBookingLinks

    APIMeetings --> Access
    APIMeetings --> Lifecycle
    APIBookingLinks --> Resolver
    APIOutcome --> Lifecycle

    Lifecycle --> Resolver
    Lifecycle --> SeqEngine
    Lifecycle --> DB
    SeqEngine --> Redis
```

---

## 2. Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    TENANT ||--o{ USER : "has"
    TENANT ||--o{ CLIENT : "owns"
    TENANT ||--o{ BOOKING_LINK : "contains"
    TENANT ||--o{ MEETING : "records"

    CLIENT ||--o{ CAMPAIGN : "runs"
    CLIENT ||--o{ BOOKING_LINK : "configures"
    CLIENT ||--o{ MEETING : "associates"

    CAMPAIGN ||--o{ LEAD : "contains"
    CAMPAIGN ||--o{ BOOKING_LINK : "overrides"
    CAMPAIGN ||--o{ MEETING : "tracks"

    USER ||--o{ MEETING : "books as SDR"
    USER ||--o{ BOOKING_LINK : "creates"
    USER ||--o{ TASK : "assigned"

    LEAD ||--o{ MEETING : "participates in"
    LEAD ||--o{ ACTIVITY : "generates"
    LEAD ||--o{ TASK : "spawns"

    BOOKING_LINK ||--o{ MEETING : "used by (snapshot)"

    BOOKING_LINK {
        string id PK
        string clientId FK
        string campaignId FK
        string name
        string url
        enum provider
        string ownerName
        string ownerEmail
        int durationMins
        boolean isDefault
        boolean isActive
    }

    MEETING {
        string id PK
        string leadId FK
        string clientId FK
        string campaignId FK
        string sdrId FK
        string bookingLinkId FK
        string bookingLinkUrlSnapshot
        enum status
        enum outcome
        datetime scheduledAt
        int durationMins
        string meetingUrl
        string outcomeNotes
    }
```

---

## 3. Meeting Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> LinkSent: SDR sends link
    [*] --> Scheduled: Direct booked / SDR scheduled

    LinkSent --> Scheduled: Prospect selects calendar slot
    LinkSent --> Cancelled: Prospect declines

    Scheduled --> Completed: Call attended
    Scheduled --> NoShow: Prospect did not attend
    Scheduled --> Rescheduled: Need new date/time
    Scheduled --> Cancelled: Call cancelled

    NoShow --> Scheduled: Rescheduled
    Rescheduled --> Scheduled: New slot picked

    Completed --> OutcomeLogged: SDR / Manager logs outcome
    OutcomeLogged --> QualifiedOpportunity: Feeds pipeline (Stage: Won)
    OutcomeLogged --> WrongFit: Disqualified
    OutcomeLogged --> FollowUpLater: Future follow-up task created
```

---

## 4. Operational SDR & Automation Sequence

```mermaid
sequenceDiagram
    autonumber
    actor SDR as SDR
    actor Prospect as Prospect
    participant UI as LeadDetailPanel
    participant API as Meetings API
    participant Engine as MeetingLifecycle Engine
    participant DB as PostgreSQL DB
    participant Seq as Sequence Engine

    SDR->>UI: Clicks "Book Meeting"
    UI->>API: GET /api/booking-links (Resolved Link)
    API->>UI: Returns default campaign/client booking link
    SDR->>UI: Selects "Schedule Meeting" with Date & URL
    UI->>API: POST /api/meetings (status: 'scheduled')
    API->>Engine: scheduleMeeting()
    Engine->>DB: Snapshots link + creates Meeting record
    Engine->>DB: Updates Lead stage to "meeting_booked"
    Engine->>Seq: pauseSequence(leadId)
    Engine->>DB: Creates high-priority outcome task
    Engine->>DB: Logs activity ("meeting_booked")
    API-->>UI: Success confirmation
    Note over SDR,Prospect: Meeting takes place
    SDR->>UI: Opens "Log Outcome" Modal
    UI->>API: POST /api/meetings/[id]/outcome
    API->>Engine: logMeetingOutcome()
    Engine->>DB: Records outcome & notes
    alt Outcome is Qualified Opportunity
        Engine->>DB: Moves Lead stage to "won"
    else Outcome is No-Show / Reschedule
        Engine->>DB: Auto-generates follow-up task
    end
```

---

## 5. File & Route Directory

| Component | Path | Description |
|---|---|---|
| **Dashboard** | `app/meetings/page.tsx` | Main dashboard with KPIs and table |
| **Settings** | `components/meetings/BookingLinkSettingsPanel.tsx` | Link manager in `app/settings` |
| **Lead Modal** | `components/meetings/MeetingBookingModal.tsx` | Scheduling & link copy popup |
| **Outcome Modal** | `components/meetings/MeetingOutcomeModal.tsx` | Post-call outcome logger |
| **Status Badge** | `components/meetings/MeetingStatusBadge.tsx` | Status pill badges |
| **Resolver** | `lib/meetings/bookingLinks.ts` | Waterfall link resolution |
| **Lifecycle** | `lib/meetings/meetingLifecycle.ts` | Transitions, tasks, sequence pause |
| **Access** | `lib/meetings/meetingAccess.ts` | Tenant/Role permission security |
| **Unit Tests** | `tests/meetings.test.ts` | Vitest automated test suite |
