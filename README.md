# ReachInbox Email Scheduler

A production-grade email scheduler with a Next.js dashboard, built for the ReachInbox/Outbox Labs assignment. Features include scheduling emails with BullMQ delayed jobs, PostgreSQL persistence, Elasticsearch search, real-time Slack notifications for rate limits, and a comprehensive dashboard for managing email campaigns.

## Tech Stack

**Backend:** TypeScript, Express, BullMQ, Redis, PostgreSQL, Elasticsearch, Ethereal Email, Slack OAuth  
**Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, NextAuth (Google OAuth)

## 🚀 Live Deployment

| Component | Provider | URL |
|---|---|---|
| Frontend | Vercel | https://reachinbox-email-scheduler-campus.vercel.app |
| Backend API | Azure App Service (Linux, Node 22) | https://reachinbox-backend-api-v2-fnaub4h8cga8f4g9.centralindia-01.azurewebsites.net |
| Email Worker | Azure App Service (Linux, Node 22) | https://reachinbox-worker-gjb6crg5hyfphgh8.centralindia-01.azurewebsites.net |
| PostgreSQL | Azure Database for PostgreSQL – Flexible Server | (private) |
| Redis | Upstash (managed Redis) | (private) |
| Elasticsearch | Azure Container Instance | (private) |

Backend and Worker are deployed as **two separate Azure App Service instances** running the exact same codebase — the Worker overrides the default start command to run `dist/worker/emailWorker.js` instead of `dist/index.js`. Both are deployed via GitHub Actions on every push to `main`.

### Deployment notes / gotchas encountered

These are documented for anyone redeploying or debugging this setup in the future:

- **Worker needs a dummy HTTP listener.** Azure App Service's platform health-check expects the app to respond on the assigned `PORT`. Since the worker doesn't serve HTTP traffic, it was silently killed and restarted in a loop until a minimal `http.createServer(...)` health-check endpoint was added inside `emailWorker.ts`.
- **"Always On" must be enabled** (App Service → Configuration → General settings) for the Worker, otherwise Azure treats it as an idle web app and can suspend it.
- **PostgreSQL Flexible Server networking:** "Allow public access from any Azure service within Azure" must be enabled under Networking, or connections from App Service will hang/timeout.
- **`uuid-ossp` extension:** Azure Database for PostgreSQL requires extensions to be allow-listed via Server Parameters → `azure.extensions` before migrations using `uuid_generate_v4()` will succeed.
- **Migrations on Azure:** run via `backend/src/scripts/runAllMigrations.ts` (`npm run migrate`) executed once from the Azure Kudu SSH console after first deploy, since there's no separate migration step in the CI/CD pipeline.
- **NEXTAUTH_URL / cookies:** Google OAuth login must always be accessed via the **stable Vercel production domain** (not the per-deployment preview URL), otherwise NextAuth's state cookie won't match between the login and callback requests.
- **NEXTAUTH_SECRET** must be identical between the Vercel frontend and both Azure backend/worker environments, since the backend independently decodes the session JWT to authenticate API requests.

## Architecture Overview

### Scheduling Workflow
When a user schedules an email via the Compose form:
1. The frontend sends a POST request to `/schedule` with recipient, subject, body, scheduled time, sender ID, and optional per-request delayMs/hourlyLimit overrides.
2. The backend validates the input and generates an idempotency key using SHA-256 of recipient+subject+scheduledAt to prevent duplicates.
3. A new row is inserted into the `emails` table with status='pending'.
4. A BullMQ delayed job is enqueued with:
   - Job ID = the idempotency key (ensuring deduplication)
   - Delay = scheduledAt - current time (0 if scheduled in the past)
   - Job data containing email details and any per-request overrides
5. The email record is updated with the BullMQ job ID and indexed in Elasticsearch (non-blocking).

### Persistence on Restart
- Email state lives in PostgreSQL (scheduled/sent/failed statuses, metadata).
- BullMQ jobs live in Redis (including delayed jobs).
- When the server/worker restarts:
  - BullMQ redelivers delayed jobs from Redis once their delay elapses.
  - The worker processes each job, updates the email status in PostgreSQL accordingly.
  - No cron is used; scheduling is entirely event-driven via BullMQ delays.

### Rate Limiting
- Uses Redis counters with key `ratelimit:{senderId}:{YYYY-MM-DD-HH}` for per-sender-per-hour tracking.
- Before sending, the worker checks the current count against the hourly limit (from job data or env var `MAX_EMAILS_PER_HOUR_PER_SENDER`).
- If at/over limit:
  - Worker increments `emails.rate_limited_count`.
  - Enqueues a NEW delayed job for the start of the next hour (preserving recipient/subject/body/senderId and any per-request delayMs/hourlyLimit overrides).
  - Current job completes without sending (non-blocking — worker slot is immediately free).
  - Slack notification is sent (if connected).
- Per-request delayMs/hourlyLimit (from Compose form) override global env defaults when provided.
- To prevent a thundering herd of rescheduled jobs at the exact start of the next hour, a random jitter of 0-120 seconds is added to the delay when rescheduling. This spreads out the rescheduled jobs over a two-minute window, reducing the likelihood of many workers trying to send emails at the same instant.

### Concurrency & Throttling
- BullMQ Worker concurrency is configurable via `WORKER_CONCURRENCY` env var.
- A BullMQ limiter (`{max: 1, duration: MIN_DELAY_MS_BETWEEN_SENDS}`) enforces a minimum delay between the **start** of consecutive sends.
- This limiter is concurrency-safe: regardless of worker concurrency level, only one job can start processing every `MIN_DELAY_MS_BETWEEN_SENDS` milliseconds.
- Unlike a manual `setTimeout`, the BullMQ limiter correctly handles job distribution across multiple workers and prevents drift.

### Slack Notifications
- Real OAuth flow:
  - `GET /slack/oauth/start?senderId=xxx` redirects to Slack with state stored in Redis.
  - `GET /slack/oauth/callback` exchanges code for token, stores incoming webhook URL in `slack_connections` table.
- When rate limit is hit:
  - Worker performs a fresh DB read of the sender's Slack webhook (no caching).
  - Posts a live message to the Slack channel via the webhook.
  - If no Slack connection exists, notification is silently skipped (no crash; connecting later works without redeploying).

### Elasticsearch Integration
- Emails are indexed on creation and every status change (sent/failed/rescheduled) via non-blocking `indexEmail()` call.
- If Elasticsearch is down, core scheduling/sending continues unaffected.
- Search endpoint: `GET /emails/search?q=` queries Elasticsearch for subject/recipient matches, returning the PostgreSQL-matching `id` for each result.

### BullMQ Dashboard
- Live queue visualization mounted at `/admin/queues` via bull-board.
- Shows waiting, active, delayed, completed, and failed job counts.

## High-Level Design (HLD)
```mermaid
graph TD
    A[User Browser] --> B(Frontend: Next.js on Vercel)
    B --> C[Backend: Express API on Azure App Service]
    C --> D[(PostgreSQL - Azure Flexible Server)]
    C --> E[(Redis - Upstash)]
    C --> F[(Elasticsearch - Azure Container Instance)]
    C --> G[BullMQ Queue]
    G --> H[Email Worker on Azure App Service]
    H --> D
    H --> E
    C --> I[Slack API]
    C --> J[Ethereal Email Service]
```

## Low-Level Design (LLD)
```mermaid
flowchart LR
    subgraph API[Backend API]
        direction TB
        S1[POST /schedule] --> S2[Validate & Generate Idempotency Key]
        S2 --> S3[Insert email pending]
        S3 --> S4[Enqueue BullMQ job]
        S4 --> S5[Update email with job ID]
        S5 --> S6[Index in Elasticsearch]
        
        S7[GET /emails/:id] --> S8[Select email]
        S9[PATCH /emails/:id/star] --> S10[Update email set starred]
        S11[POST /emails/:id/resend] --> S12[Create new email record]
        S13[GET /slack/oauth/start] --> S14[Redirect to Slack]
        S15[GET /slack/oauth/callback] --> S16[Exchange code, store webhook]
    end
    
    subgraph Worker[Email Worker]
        direction TB
        W1[Pull Job from BullMQ] --> W2[Check Rate Limit]
        W2 -->|Over Limit| W3[Reschedule for next hour]
        W2 -->|Under Limit| W4[Send Email via Ethereal]
        W4 --> W5[Update email status sent/failed]
        W5 --> W6[Update rate limit counters]
        W6 --> W7[Update last sent timestamp]
        W4 --> W8[Notify Slack if rate limit hit]
    end
    
    subgraph DB[PostgreSQL]
        DB1[emails table]
        DB2[senders table]
        DB3[slack_connections table]
    end
    
    subgraph Redis[Redis]
        R1[ratelimit:sender:hour]
        R2[lastsent:sender]
    end
    
    API --> DB
    Worker --> DB
    Worker --> Redis
```

## Local Development Setup

### Prerequisites
- Node.js (v18+)
- Docker Desktop

### Installation

1. Clone the repository:
```bash
   git clone <repository-url>
   cd reachinbox-email-scheduler
```

2. Install backend dependencies:
```bash
   cd backend
   npm install
```

3. Install frontend dependencies:
```bash
   cd ../frontend
   npm install
```

### Environment Configuration

#### Backend
Copy `backend/.env.example` to `backend/.env` and fill in the values:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node environment | `development` |
| `PORT` | Backend server port | `3000` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3001` |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port (see docker-compose) | `5434` |
| `POSTGRES_USER` | PostgreSQL username | `email_scheduler` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `email_scheduler_pass` |
| `POSTGRES_DB` | PostgreSQL database | `email_scheduler` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port (see docker-compose) | `6381` |
| `REDIS_PASSWORD` | Redis password (if set) | *(optional)* |
| `ETHEREAL_USER` | Ethereal SMTP user (for testing) | *(leave empty for auto-generated test account)* |
| `ETHEREAL_PASS` | Ethereal SMTP pass | *(leave empty for auto-generated test account)* |
| `ETHEREAL_HOST` | Ethereal SMTP host | `smtp.ethereal.email` |
| `ETHEREAL_PORT` | Ethereal SMTP port | `587` |
| `WORKER_CONCURRENCY` | Number of parallel email sending jobs | `3` |
| `MIN_DELAY_MS_BETWEEN_SENDS` | Minimum delay between send starts (ms) | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly limit per sender | `200` |
| `ES_HOST` | Elasticsearch HTTP URL | `http://localhost:9201` |
| `SLACK_CLIENT_ID` | Slack OAuth Client ID | `xoxb-1234567890-1234567890-EXAMPLE` |
| `SLACK_CLIENT_SECRET` | Slack OAuth Client Secret | `1234567890abcdef1234567890abcdef` |
| `SLACK_REDIRECT_URI` | Slack OAuth redirect URI | `http://localhost:3000/slack/oauth/callback` |

#### Frontend
Create `frontend/.env.local` (copy from the example below) and fill in Google OAuth credentials:

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:3000` |
| `NEXT_PUBLIC_DEFAULT_SENDER_ID` | Default sender UUID (optional) | `db9bcfcf-ea03-4304-af57-ee5a5cd20bf7` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `1234567890-abc123def456ghi789jk0lmnopqrstu.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-1234567890abcdefghijklmnopqrstuvwxyz` |
| `NEXTAUTH_URL` | NextAuth URL (must match frontend port) | `http://localhost:3001` |
| `NEXTAUTH_SECRET` | NextAuth encryption secret | `1234567890abcdef1234567890abcdef` |

### Infrastructure Setup

1. Start PostgreSQL, Redis, and Elasticsearch via Docker Compose:
```bash
   # From repo root
   docker-compose up -d
```
   This will start:
   - PostgreSQL on `localhost:5434`
   - Redis on `localhost:6381`
   - Elasticsearch on `localhost:9201`

2. Apply database migrations (all at once, in order):
```bash
   # From backend directory
   npm run migrate
```
   This runs `src/scripts/runAllMigrations.ts`, which reads every `.sql` file in `backend/migrations/` and executes them alphabetically, each inside its own transaction.

3. Ethereal Setup (for development/testing):
```bash
   # From backend directory
   npm run setup:ethereal
```
   This command generates a temporary Ethereal test account and prints credentials to the console. If `ETHEREAL_USER` and `ETHEREAL_PASS` are set in `.env`, those credentials are used instead.

### Starting the Application

1. Start the backend API server:
```bash
   # From backend directory
   npm run dev
```
   Runs on `http://localhost:3000`

2. Start the worker (separate terminal):
```bash
   # From backend directory
   npm run worker
```

3. Start the frontend development server:
```bash
   # From frontend directory
   npm run dev
```
   Runs on `http://localhost:3001`

4. Visit the dashboard at `http://localhost:3001` and log in with Google OAuth.

## Features Implemented

### Backend
- ✅ Scheduling via BullMQ delayed jobs (no cron)
- ✅ PostgreSQL persistence for email state
- ✅ Restart-safe: no duplicate sends, idempotency key prevents duplication
- ✅ Elasticsearch search for emails by subject/recipient
- ✅ Live BullMQ dashboard at `/admin/queues`
- ✅ Configurable worker concurrency (`WORKER_CONCURRENCY`)
- ✅ Configurable minimum delay between sends (`MIN_DELAY_MS_BETWEEN_SENDS`)
- ✅ Configurable + dynamic per-request hourly rate limit (overrides global default)
- ✅ Redis-backed rate limit counters (safe across multiple workers)
- ✅ Non-blocking reschedule on rate limit (not dropped; new job enqueued for next hour)
- ✅ Real Slack OAuth + live notification on rate limit hit
- ✅ Disconnect/reconnect safe (Slack tokens stored in DB, fresh read on each notification)
- ✅ Deployed to Azure App Service (backend API + worker as separate instances)

### Frontend
- ✅ Real Google OAuth login (via NextAuth)
- ✅ Header with avatar/name/email + logout
- ✅ Scheduled/Sent/Archived tabs with live counts
- ✅ Compose page:
  - Subject, body, CSV/text lead upload with parsed count
  - Per-recipient scheduling (one request per recipient)
  - Delay/hourly-limit overrides per campaign
  - Send-later scheduling (date/time picker)
- ✅ Loading states, empty states
- ✅ Star/archive/delete(with confirmation)/resend actions
- ✅ Search (subject/recipient)
- ✅ Sent/failed filter
- ✅ Reusable components (Button, EmailList, RecipientInput, etc.)
- ✅ TypeScript throughout
- ✅ Deployed to Vercel

## Assumptions, Shortcuts, and Trade-offs

- **File attachments in Compose:** UI-only (visual, matching Figma design); not actually sent as email attachments or stored on backend. Only CSV/text lead-list upload (explicitly required) is functional.
- **Rich text toolbar:** Uses browser's native `document.execCommand` for basic formatting (bold, italic, etc.) rather than a full editor library, as it's out of scope for assignment grading.
- **TypeScript warnings:** Intentional reduction of type safety via `"strict": false` in tsconfig.json (primarily to avoid warnings from missing `@types/pg` and `@types/nodemailer`, and `unknown`-typed fetch responses). This allows implicit `any` types where stricter checking would fail, trading compile-time safety for assignment scope compliance while maintaining runtime stability via `ts-node-dev --transpile-only`.
- **Ethereal Email:** Used for testing only; in production would be swapped for a real ESP (SendGrid, SES, etc.).
- **Multi-recipient scheduling:** Sends one `POST /schedule` per recipient (schema stores one recipient per row) rather than a single bulk-insert endpoint.
- **Worker as a second App Service:** Chosen over a single combined process to mirror a realistic production topology (API and background workers scaled independently); required adding a lightweight HTTP health-check endpoint purely to satisfy Azure App Service's platform health monitoring.

## Demo Video

[Demo video link to be added here]
