import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: resolve(__dirname, '../../.env') });

// Validate required environment variables
const requiredEnvVars = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'REDIS_HOST',
  'REDIS_PORT',
  'WORKER_CONCURRENCY',
  'MIN_DELAY_MS_BETWEEN_SENDS',
  'MAX_EMAILS_PER_HOUR_PER_SENDER',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// Parse numeric env vars with defaults
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY!) || 3;
const MIN_DELAY_MS_BETWEEN_SENDS = parseInt(process.env.MIN_DELAY_MS_BETWEEN_SENDS!) || 2000;
const MAX_EMAILS_PER_HOUR_PER_SENDER = parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER!) || 200;

import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db/pool';
import { redisConnection } from '../queue/emailQueue'; // Reuse the same Redis connection as the queue
import { notifySlackRateLimitHit } from '../services/slackNotifier'; // Slack notifications
import { indexEmail } from '../services/emailIndexer'; // Elasticsearch indexing

// Function to create a nodemailer transporter using Ethereal credentials from .env
// If credentials are not provided, fall back to creating a test account (for development)
// This is created once at module load and reused across jobs
let transporter: nodemailer.Transporter;
async function initializeTransporter() {
  const etherealUser = process.env.ETHEREAL_USER;
  const etherealPass = process.env.ETHEREAL_PASS;
  const etherealHost = process.env.ETHEREAL_HOST || 'smtp.ethereal.email';
  const etherealPort = Number(process.env.ETHEREAL_PORT) || 587;

  if (etherealUser && etherealPass) {
    // Use provided Ethereal credentials
    console.log('Using Ethereal credentials from .env');
    transporter = nodemailer.createTransport({
      host: etherealHost,
      port: etherealPort,
      secure: false, // Ethereal uses STARTTLS on port 587
      auth: {
        user: etherealUser,
        pass: etherealPass,
      },
    });
  } else {
    // Fallback to creating a test account (useful for initial setup)
    console.warn('ETHEREAL_USER or ETHEREAL_PASS not set in .env. Creating a temporary Ethereal test account.');
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }
}


// Process function for each job in the queue
async function processJob(job: any) {
  console.log(`Processing job ${job.id} of type ${job.name}`);

  const { emailId, recipient, subject, body } = job.data;

  // Validate required data
  if (!emailId || !recipient || !subject || !body) {
    throw new Error('Job data missing required fields: emailId, recipient, subject, body');
  }

  // Fetch sender_id from the emails table for this email
  let senderId: string;
  try {
    const senderResult = await pool.query(
      'SELECT sender_id FROM emails WHERE id = $1',
      [emailId]
    );
    if (senderResult.rowCount === 0) {
      throw new Error(`Email not found for id: ${emailId}`);
    }
    senderId = senderResult.rows[0].sender_id;
  } catch (error) {
    console.error(`Failed to fetch sender_id for email ${emailId}:`, error);
    throw error;
  }

  // --- HOURLY RATE LIMITING PER SENDER USING REDIS (PER-EMAIL LIMIT) ---
  // Note: We use an atomic increment to avoid race conditions. This counts *attempts* (including
  // reschedules) to be safe under concurrency. A slightly early rate-limit trigger is acceptable.
  const hourlyLimit = job.data.hourlyLimit && job.data.hourlyLimit > 0 ? job.data.hourlyLimit : MAX_EMAILS_PER_HOUR_PER_SENDER;
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13); // YYYY-MM-DD-HH
  const redisKey = `ratelimit:${senderId}:${hourKey}`;

  // Atomically increment the counter and get the new value
  const currentCount = await redisConnection.incr(redisKey);
  // Set expiration only on the first increment (so it expires after 2 hours from the first hit in the hour)
  if (currentCount === 1) {
    await redisConnection.expire(redisKey, 2 * 3600);
  }

  // If we have exceeded the limit (after incrementing), reschedule for the next hour
  if (currentCount > hourlyLimit) {
    console.warn(
      `Hourly limit reached for sender ${senderId} (${currentCount}/${hourlyLimit}) in hour ${hourKey}. ` +
      `Rescheduling email ${emailId} for the next hour.`
    );

    // Notify Slack about the rate limit hit
    await notifySlackRateLimitHit(senderId, {
      senderIdString: senderId,
      count: currentCount,
      max: hourlyLimit,
      hourKey: hourKey,
      emailId: emailId
    });

    // Calculate delay until the start of the next hour with random jitter (0-120s) to prevent thundering herd
    const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
    const baseDelayMs = nextHour.getTime() - now.getTime();
    const jitterMs = Math.floor(Math.random() * 120000); // 0-120 seconds in milliseconds
    const delayMsUntilNextHour = baseDelayMs + jitterMs;
    const newJobId = uuidv4();

    // Re-enqueue a NEW delayed job for the next hour, preserving this job's data
    const emailQueueModule = await import('../queue/emailQueue');
    await emailQueueModule.emailQueue.add(
      'send-email',
      {
        emailId,
        recipient,
        subject,
        body,
        senderId,
        delayMs: job.data.delayMs,
        hourlyLimit: job.data.hourlyLimit,
      },
      {
        jobId: newJobId,
        delay: delayMsUntilNextHour,
      }
    );

    // Update the email record: new bullmq_job_id, increment rate_limited_count
    const rescheduleClient = await pool.connect();
    try {
      await rescheduleClient.query('BEGIN');
      const updateQuery = `
        UPDATE emails
        SET bullmq_job_id = $1, rate_limited_count = rate_limited_count + 1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived, rate_limited_count
      `;
      const updateResult = await rescheduleClient.query(updateQuery, [newJobId, emailId]);
      await rescheduleClient.query('COMMIT');
      const updatedEmail = updateResult.rows[0];

      indexEmail(updatedEmail).catch(err => {
        console.error(`Failed to re-index email ${updatedEmail.id} after reschedule:`, err);
      });

      console.log(`Email ${emailId} rescheduled: new job ID ${newJobId}, delay ${delayMsUntilNextHour}ms`);
    } catch (updateError) {
      await rescheduleClient.query('ROLLBACK');
      throw updateError;
    } finally {
      rescheduleClient.release();
    }

    // Current job is done — we rescheduled instead of sending. Do NOT fall through to the send logic below.
    return;
  }

  // --- PER-SENDER DELAY BETWEEN SENDS (on top of worker-wide BullMQ limiter) ---
  // The worker-wide BullMQ limiter ensures at least MIN_DELAY_MS_BETWEEN_SENDS between the start of job processing.
  // We now add an extra delay per sender if the job's delayMs is greater than the worker's default.
  const effectiveMinDelay = MIN_DELAY_MS_BETWEEN_SENDS;
  const jobDelay = job.data.delayMs && job.data.delayMs > 0 ? job.data.delayMs : 0;
  if (jobDelay > effectiveMinDelay) {
    const lastSentKey = `lastsent:${senderId}`;
    const lastSent = await redisConnection.get(lastSentKey);
    let waitMs = 0;
    if (lastSent) {
      const lastSentTime = parseInt(lastSent, 10);
      const elapsed = Date.now() - lastSentTime;
      if (elapsed < jobDelay) {
        waitMs = jobDelay - elapsed;
      }
    }
    if (waitMs > 0) {
      console.log(
        `Sender ${senderId} needs to wait ${waitMs}ms for per-email delay (last sent ${new Date(parseInt(lastSent, 10)).toISOString()})`
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  // --- SEND THE EMAIL ---
  // Send the email using the pre-initialized transporter
  let info;
  try {
    info = await transporter.sendMail({
      from: '"Email Scheduler" <noreply@ethereal.email>', // You can make this configurable
      to: recipient,
      subject,
      text: body,
      html: `<p>${body.replace(/\n/g, '<br>')}</p>`, // Simple conversion of newlines to <br>
    });

    console.log(`Email sent successfully: ${info.messageId}`);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info)); // Only works for Ethereal

    // Update the email record to status='sent'
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updateQuery = `
        UPDATE emails
        SET status = 'sent', sent_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING id, sender_id, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
      `;
      const result = await client.query(updateQuery, [emailId]);
      await client.query('COMMIT');
      const updatedEmail = result.rows[0];
      console.log(`Email ${emailId} marked as sent`);

      // Index the updated email record in Elasticsearch (non-blocking)
      indexEmail(updatedEmail).catch(err => {
        console.error(`Failed to index email ${updatedEmail.id} after sending:`, err);
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // --- UPDATE RATE LIMIT COUNTERS AND LAST SENT TIMESTAMP AFTER SUCCESSFUL SEND ---
    // Note: we already incremented the hourly counter atomically at the start of the function.
    // Update the last sent timestamp for the sender
    const sendTime = new Date();
    await redisConnection.set(`lastsent:${senderId}`, sendTime.getTime().toString());
    await redisConnection.expire(`lastsent:${senderId}`, 24 * 3600); // 24 hours

  } catch (error) {
    console.error(`Failed to send email for job ${job.id}:`, error);

    // Update the email record to status='failed'
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updateQuery = `
        UPDATE emails
        SET status = 'failed', updated_at = NOW()
        WHERE id = $1
        RETURNING id, sender_id, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
      `;
      const result = await client.query(updateQuery, [emailId]);
      await client.query('COMMIT');
      const updatedEmail = result.rows[0];
      console.log(`Email ${emailId} marked as failed`);

      // Index the updated email record in Elasticsearch (non-blocking)
      indexEmail(updatedEmail).catch(err => {
        console.error(`Failed to index email ${updatedEmail.id} after failure:`, err);
      });
    } catch (updateError) {
      await client.query('ROLLBACK');
      console.error(`Failed to update email ${emailId} to failed status:`, updateError);
    } finally {
      client.release();
    }

    // Re-throw the error so BullMQ knows the job failed (and can retry if configured)
    throw error;
  }
}

(async () => {
  await initializeTransporter();

  // Create the worker
  const worker = new Worker(
    'email-send', // queue name
    processJob,   // processor function
    {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      // Concurrency: number of jobs the worker can process in parallel
      concurrency: WORKER_CONCURRENCY,
      // Rate limiter: ensures at least MIN_DELAY_MS_BETWEEN_SENDS between the start of job processing
      // This is concurrency-safe because the limiter is applied per job slot, not per worker.
      // Explanation: The limiter setting { max: 1, duration: MIN_DELAY_MS_BETWEEN_SENDS } means:
      //   - In any window of MIN_DELAY_MS_BETWEEN_SENDS milliseconds, at most 1 job can be *processed*.
      //   - If concurrency > 1, the worker can pull up to `concurrency` jobs at once, but the limiter
      //     will only allow one job to start processing every MIN_DELAY_MS_BETWEEN_SENDS ms.
      //   - This guarantees a minimum delay between the *start* of two consecutive email sends,
      //     regardless of concurrency level.
      limiter: {
        max: 1,
        duration: MIN_DELAY_MS_BETWEEN_SENDS,
      },
    }
  );

  // Listen for events
  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.log(`Job ${job.id} failed with error: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing worker...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Closing worker...');
    await worker.close();
    process.exit(0);
  });

  console.log(`Email worker started with concurrency=${WORKER_CONCURRENCY}, minDelay=${MIN_DELAY_MS_BETWEEN_SENDS}ms, maxPerHourPerSender=${MAX_EMAILS_PER_HOUR_PER_SENDER}`);
})().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});