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
- This limiter is concurrency-safe:
