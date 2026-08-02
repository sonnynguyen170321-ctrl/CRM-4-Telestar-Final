# SalesFlow CRM — Multi-Tenant BPO SDR & Outbound Revenue Platform

A production-grade, multi-tenant BPO SDR-as-a-Service CRM built with **Next.js 16 (App Router)**, **Prisma ORM (PostgreSQL)**, **BullMQ + Redis**, and **Tailwind CSS**.

---

## 🏗️ Platform Architecture & Revenue Workflow

```text
+---------------------------------------------------------------------------------------+
|                                1. LEAD INTAKE & POOL                                  |
|   Raw Lists / CSV / Integrations --> Internal Lead Database (LeadPoolItem)            |
|   * Deduplication & Data Quality Scoring                                              |
|   * Enrichment & ICP Fit Evaluation                                                   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                               2. QUALIFY & ROUTE                                      |
|   Leadgen Manager Console --> Campaign Requirements Matching                          |
|   * Single / Round-Robin SDR Assignment                                              |
|   * Conversion to Working SDR 'Lead' Records                                          |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                               3. OUTREACH & SEQUENCES                                 |
|   SDR Execution / Multi-step Automated Cadences (BullMQ Worker Engine)               |
|   * Automated & Manual Steps (Email, Call, LinkedIn, Tasks)                           |
|   * Inbox Sync, Thread Parsing, Sentiment & Bounce Detection                          |
|   * Dynamic Deliverability Throttling & Ramp Schedules (Email Health)                |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                               4. MEETING CONVERSION                                   |
|   Waterfall Booking Links (SDR -> Campaign -> Company Fallback)                      |
|   * Dynamic Host Resolution & Timezone Calculations                                   |
|   * Attendance & Outcome Engine (Completed, Qualified, No-Show, Rescheduled)         |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                               5. OPPORTUNITY PIPELINE                                 |
|   Deal & Revenue Management (Opportunity Model)                                       |
|   * Multi-Stage Kanban (Discovery -> Demo -> Proposal -> Negotiation -> Won/Lost)    |
|   * Client-Facing Campaign Reports & Deliverability Health Export (PDF / CSV / Share) |
+---------------------------------------------------------------------------------------+
```

---

## 👥 Role Hierarchy & Access Matrix

| Role | Scope / Responsibilities | Primary Interface |
| :--- | :--- | :--- |
| **Director** | Global tenant access, executive KPIs, billing, worker management, system configuration | `/director`, `/admin/jobs`, `/client-reports`, All Modules |
| **Floor Manager** | Operational management across all SDR pods, team campaigns, queue health, reporting | `/team`, `/client-reports`, `/email-health`, All Modules |
| **Team Lead** | Pod-level SDR management, 1-on-1 coaching, meeting reviews, campaign lead velocity | `/team`, `/opportunities`, `/leads`, `/meetings` |
| **SDR** | Assigned campaign execution, lead outreach, sequence cadence, meeting booking | `/leads`, `/inbox`, `/sequences`, `/meetings`, `/opportunities` |
| **Leadgen Manager** | Internal lead pool management, bulk intake, deduplication, campaign routing, team QA | `/leadgen-manager`, `/client-reports`, `/settings` |
| **Leadgen (Member)** | Lead research, enrichment, contact validation, qualification submission | `/leadgen`, `/settings` |

---

## 📦 Core Modules

### 1. Leadgen Manager & Internal Lead Database
* **Internal Lead Pool (`LeadPoolItem`)**: Unassigned raw lead database isolated from SDR working queues until qualified.
* **Deduplication Engine**: Composite matching across normalized email, phone, LinkedIn URL, and company/full-name keys.
* **Campaign Lead Requirements**: Track lead quotas, target ICP titles, industries, geographies, and delivery deadlines.
* **Distribution Engine**: Bulk qualification, campaign allocation, and single or round-robin SDR distribution.
* **Intake & Export**: BullMQ worker-driven bulk CSV intake and filtered CSV export.

### 2. Cadence & Automated Sequence Engine
* **Asynchronous Execution**: High-throughput distributed task scheduling with BullMQ and Redis.
* **Multi-Channel Steps**: Automated email, manual phone dialer prompts, LinkedIn touches, custom tasks.
* **Safety & Compliance**: Suppression lists (email, domain, company level), rate limiters, and atomic daily account caps.
* **Fast-Forward (Run Now)**: Instant task advancement bypassing scheduled delays for interactive testing and manual triggers.

### 3. Meeting Booking & Outcome Engine
* **Waterfall Booking Links**: Smart public booking links resolving SDR personal links -> Campaign calendar -> Company general link.
* **Outcome Lifecycle**: Track meeting outcomes (`completed`, `no_show`, `cancelled`, `rescheduled`) and qualification status (`qualified`, `unqualified`).
* **Opportunity Generation**: Direct 1-click deal creation from qualified meeting outcomes.

### 4. Opportunity & Deal Pipeline
* **Visual Kanban**: Drag-and-drop opportunity cards across customizable sales stages (`discovery`, `demo`, `proposal`, `negotiation`, `closed_won`, `closed_lost`).
* **Handoff Tracking**: Audit history tracking origin SDR, Assigned AE, and Leadgen sourcing.
* **Pipeline Analytics**: Win rates, average deal cycle velocity, weighted pipeline value, and loss reason categorization.

### 5. Client-Facing Campaign Reports
* **Executive Summaries**: High-level BPO performance metrics (Total Outbound, Contacts Engaged, Meetings Booked, Pipeline Value).
* **Multi-Format Export**:
  - Secure public shareable link with customizable date range filter.
  - Formatted PDF export engine.
  - Detailed CSV data export.
* **Deliverability Health Posture**: Integrated email channel health metrics for transparency with BPO clients.

### 6. Deliverability & Email Health Dashboard
* **DNS Verification**: Real-time validation for SPF, DKIM, DMARC, and MX records.
* **Automated Warmup**: 4-stage configurable ramp schedule with automatic daily volume increments.
* **Dynamic Safety Throttling**: Auto-reduces sending limits or pauses mailboxes upon hitting bounce/spam complaint thresholds.
* **SMTP/Bounce Categorization**: Intelligent categorization of hard bounces, soft bounces, rate limits, and mailbox full errors.

---

## 🛠️ Tech Stack & Infrastructure

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React 19)
- **Database & ORM**: PostgreSQL via [Prisma ORM](https://www.prisma.io/)
- **Distributed Queues**: [BullMQ](https://bullmq.io/) + [Redis](https://redis.io/)
- **Email Adapters**: Gmail API (OAuth 2.0), Microsoft Graph API (OAuth 2.0), IMAP/SMTP (Nodemailer)
- **Token Security**: AES-256-GCM symmetric encryption for all stored credentials (`lib/crypto.ts`)
- **Styling & UI**: Tailwind CSS, Lucide Icons

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 20+
- PostgreSQL database
- Redis instance (e.g., Upstash, Redis Cloud, or local Docker)

### 2. Environment Configuration
Copy `.env.example` to `.env.local` and configure the required values:

```bash
cp .env.example .env.local
```

Key environment variables:
```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/crm?sslmode=require"
DIRECT_URL="postgresql://user:pass@host:5432/crm?sslmode=require"

# Distributed Queue & Workers
REDIS_URL="redis://localhost:6379"

# Security & Session
AUTH_SECRET="your-32-byte-hex-secret"
NEXTAUTH_URL="http://localhost:3000"
ENCRYPTION_KEY="your-64-char-hex-key"

# Email Sending Safety Controls (Default: Disabled)
SEQUENCE_AUTOSEND_ENABLED="false"
EMAIL_HEALTH_AUTOPAUSE="false"
```

### 3. Database Migration & Setup
```bash
# Run migrations
npx prisma migrate deploy

# Generate Prisma Client
npx prisma generate

# Seed sample data (optional)
npm run db:seed
```

### 4. Running the Development Environment

#### Web Server (Next.js):
```bash
npm run dev
```

#### BullMQ Background Workers (Always-on worker process):
```bash
npm run worker:dev
```

---

## 🧪 Verification & Testing

Run the test suite across all modules:

```bash
# Unit & Integration Tests (Vitest)
npm test

# Run single test file
node node_modules/vitest/vitest.mjs run tests/leadgen-redesign.test.ts

# TypeScript Typecheck
node node_modules/typescript/bin/tsc --noEmit

# Production Build
node --max-old-space-size=4096 ./node_modules/next/dist/bin/next build
```

---

## 📖 Deployment & Production Runbook

1. **Web Host (e.g. Vercel / AWS ECS / Docker)**:
   - Build command: `npm run build`
   - Output: Standalone Next.js application
2. **Worker Host (e.g. AWS EC2 / Railway / Render)**:
   - Dedicated Node.js instance running `npm run worker:start` connected to `REDIS_URL` and `DIRECT_URL`.
3. **Database**:
   - Connection pool for web app, direct connection for Prisma migrations and long-running workers.

For comprehensive deployment & migration guides, refer to:
- [Production Migration & Cutover Runbook](docs/MIGRATION_RUNBOOK.md)
- [Docker Deployment Guide](docs/DOCKER_DEPLOY.md)
- [AWS Deployment Guide](docs/AWS_DEPLOY.md)
- [Meeting Module Architecture](docs/MEETING_MODULE_ARCHITECTURE.md)
