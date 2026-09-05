import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: resolve(__dirname, '../.env') });

// On platforms without a way to run a second process (e.g. Render free tier),
// set RUN_WORKER_INLINE=true so this same process also runs the BullMQ worker.
// On platforms that support a separate worker process/service, leave it unset
// or false, and run the worker via `npm run worker` instead.
if (process.env.RUN_WORKER_INLINE === 'true') {
  import('./worker/emailWorker');
}

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
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_REDIRECT_URI',
  'NEXTAUTH_SECRET',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

interface SlackOAuthResponse {
  ok: boolean;
  access_token?: string;
  team?: { name: string };
  incoming_webhook?: { url: string; channel: string; channel_id: string; configuration_url?: string };
}

// Parse numeric env vars with defaults
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY!) || 3;
const MIN_DELAY_MS_BETWEEN_SENDS = parseInt(process.env.MIN_DELAY_MS_BETWEEN_SENDS!) || 2000;
const MAX_EMAILS_PER_HOUR_PER_SENDER = parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER!) || 200;

import express from 'express';
import cors from 'cors';
import pool from './db/pool';
import { emailQueue, redisConnection } from './queue/emailQueue';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { ensureEmailsIndexExists, esClient } from './services/elasticsearchClient';
import { indexEmail } from './services/emailIndexer';
// BullMQ Board imports
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import auth, { authEmailOnly } from './middleware/auth';

// Load environment variables (already done above)

// Ensure Elasticsearch index exists (non-blocking)
ensureEmailsIndexExists().catch(err => {
  console.error('Failed to ensure Elasticsearch index exists:', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

// CORS middleware
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Middleware
app.use(express.json());

/**
 * Generate an idempotency key based on recipient, subject, and scheduledAt.
 * If any of these are missing, fallback to a random UUID.
 */
function generateIdempotencyKey(recipient: string, subject: string, scheduledAt: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(recipient);
  hash.update('|');
  hash.update(subject);
  hash.update('|');
  hash.update(scheduledAt);
  return hash.digest('hex');
}

/**
 * POST /schedule
 * Schedule an email to be sent at a specific time.
 */
app.post('/schedule', async (req, res) => {
  const { recipient, subject, body, scheduledAt, senderId, delayMs, hourlyLimit } = req.body;

  // Basic validation
  if (!recipient || !subject || !body || !scheduledAt || !senderId) {
    return res.status(400).json({ error: 'Missing required fields: recipient, subject, body, scheduledAt, senderId' });
  }

  // Validate scheduledAt is a valid date string
  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ error: 'scheduledAt must be a valid date string' });
  }

  let delayMsToStore = null;
  if (delayMs !== undefined && delayMs !== null && delayMs !== '') {
    const delayMsNum = parseInt(delayMs, 10);
    if (isNaN(delayMsNum) || delayMsNum <= 0) {
      return res.status(400).json({ error: 'delayMs must be a positive integer' });
    }
    delayMsToStore = delayMsNum;
  }

  let hourlyLimitToStore = null;
  if (hourlyLimit !== undefined && hourlyLimit !== null && hourlyLimit !== '') {
    const hourlyLimitNum = parseInt(hourlyLimit, 10);
    if (isNaN(hourlyLimitNum) || hourlyLimitNum <= 0) {
      return res.status(400).json({ error: 'hourlyLimit must be a positive integer' });
    }
    hourlyLimitToStore = hourlyLimitNum;
  }

  // Generate idempotency key
  const idempotencyKey = generateIdempotencyKey(recipient, subject, scheduledAt);

  // Start a transaction to ensure consistency
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the email record with status='pending'
    const insertEmailQuery = `
      INSERT INTO emails (sender_id, recipient, subject, content, scheduled_at, status, idempotency_key, is_starred, is_archived, delay_ms, hourly_limit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const emailValues = [senderId, recipient, subject, body, scheduledDate, 'pending', idempotencyKey, false, false, delayMsToStore, hourlyLimitToStore];
    const emailResult = await client.query(insertEmailQuery, emailValues);
    const email = emailResult.rows[0];

    // Index the new email record in Elasticsearch (non-blocking)
    indexEmail(email).catch(err => {
      console.error(`Failed to index new email ${email.id}:`, err);
    });

    // Calculate delay for BullMQ job: scheduledAt - now
    const now = new Date();
    const delayMs = scheduledDate.getTime() - now.getTime();
    // If scheduledAt is in the past, set delay to 0 (send immediately)
    const delay = delayMs > 0 ? delayMs : 0;

    // Add a job to the BullMQ queue with jobId = idempotencyKey (for deduplication)
    const job = await emailQueue.add(
      'send-email', // job name
      {
        emailId: email.id,
        recipient,
        subject,
        body,
        senderId,
        delayMs: delayMsToStore,
        hourlyLimit: hourlyLimitToStore,
        // We don't need to pass the entire email record, just the id and the content
      },
      {
        jobId: idempotencyKey, // This ensures that if a job with the same idempotencyKey already exists, it won't be added again
        delay, // delay in milliseconds
        // Optional: you can set attempts, backoff, etc.
        // We'll keep it simple for now
      }
    );

    // Update the email record with the BullMQ job ID
    const updateEmailQuery = `
      UPDATE emails
      SET bullmq_job_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const updateValues = [job.id, email.id];
    const updateResult = await client.query(updateEmailQuery, updateValues);
    const updatedEmail = updateResult.rows[0];

    await client.query('COMMIT');

    return res.status(201).json(updatedEmail);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error scheduling email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /emails/scheduled
 * Returns all emails with status='pending', ordered by scheduled_at
 */
app.get('/emails/scheduled', auth, async (req, res) => {
  try {
    const query = `
      SELECT id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
      FROM emails
      WHERE status = 'pending' AND is_archived = false AND sender_id = $1
      ORDER BY scheduled_at ASC
    `;
    const result = await pool.query(query, [req.senderId]);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching scheduled emails:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /emails/sent
 * Returns all emails with status IN ('sent','failed'), ordered by sent_at desc
 */
app.get('/emails/sent', auth, async (req, res) => {
  try {
    let statusCondition = "status IN ('sent', 'failed')";
    if (req.query.status === 'sent') {
      statusCondition = "status = 'sent'";
    } else if (req.query.status === 'failed') {
      statusCondition = "status = 'failed'";
    }
    // If any other value, we default to both (so no change)

    const query = `
      SELECT id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
      FROM emails
      WHERE ${statusCondition} AND sender_id = $1
      ORDER BY sent_at DESC NULLS LAST
    `;
    const result = await pool.query(query, [req.senderId]);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching sent/failed emails:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /emails/search?q=<query>
// Search emails in Elasticsearch by subject, recipient, and content
// NOTE: This must be registered BEFORE GET /emails/:id, otherwise Express matches
// "/emails/search" against the "/emails/:id" wildcard route, treating "search" as
// the id, which fails as invalid UUID syntax and returns a 500.
app.get('/emails/search', auth, async (req, res) => {
  const { q, type } = req.query;
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing search query parameter q' });
  }

  // Default to 'scheduled' if type is not provided or invalid
  const searchType =
    typeof type === 'string' && ['scheduled', 'sent', 'archived'].includes(type)
      ? type
      : 'scheduled';

  try {
    // Build the must clauses for the bool query
    const mustClauses: Record<string, any>[] = [
      {
        multi_match: {
          query: q,
          fields: ['subject^2', 'recipient', 'content'], // boost subject matches, now includes content
        }
      },
      {
        term: {
          sender_id: req.senderId
        }
      }
    ];

    if (searchType === 'scheduled') {
      mustClauses.push({ term: { status: 'pending' } });
      mustClauses.push({ term: { is_archived: false } });
    } else if (searchType === 'sent') {
      mustClauses.push({ terms: { status: ['sent', 'failed'] } });
      mustClauses.push({ term: { is_archived: false } });
    } else if (searchType === 'archived') {
      mustClauses.push({ term: { is_archived: true } });
    }

    const result = await esClient.search({
      index: 'emails',
      body: {
        query: {
          bool: {
            must: mustClauses
          }
        }
      }
    });

    // Extract the hits and map to the document source, include Elasticsearch _id as id
    const hits = result.hits.hits.map(hit => ({ id: hit._id, ...(hit._source as Record<string, any>) }));
    return res.status(200).json(hits);
  } catch (error) {
    console.error('Elasticsearch search error:', error);
    return res.status(500).json({ error: 'Elasticsearch is unavailable or search failed' });
  }

});
/**
 * GET /emails/:id
 * Returns a single email by ID with sender details
 */
app.get('/emails/:id', auth, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid email id' });
  }

  try {
    const query = `
      SELECT emails.*, senders.email AS sender_email, senders.name AS sender_name
      FROM emails
      LEFT JOIN senders ON emails.sender_id = senders.id
      WHERE emails.id = $1 AND emails.sender_id = $2
    `;
    const result = await pool.query(query, [id, req.senderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching email by ID:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /slack/oauth/start?senderId=xxx
 * Redirects to Slack's authorize URL to start the OAuth flow.
 * The senderId is passed in the state parameter (after being stored in Redis with a random token).
 */
app.get('/slack/oauth/start', async (req, res) => {
  const { senderId } = req.query;

  // Validate senderId
  if (!senderId || typeof senderId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid senderId parameter' });
  }

  // Optional: verify that the senderId exists in the senders table
  try {
    const senderResult = await pool.query('SELECT id FROM senders WHERE id = $1', [senderId]);
    if (senderResult.rowCount === 0) {
      return res.status(400).json({ error: 'Sender not found' });
    }
  } catch (dbError) {
    console.error('Database error while verifying senderId:', dbError);
    return res.status(500).json({ error: 'Internal server error' });
  }

  // Generate a random state token to prevent CSRF
  const stateToken = crypto.randomUUID();
  // Store the state token in Redis with a short TTL (10 minutes) mapping to the senderId
  await redisConnection.set(`oauth_state:${stateToken}`, senderId, 'EX', 600); // 600 seconds = 10 minutes

  // Construct the Slack OAuth URL
  const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize');
  slackAuthUrl.searchParams.set('client_id', process.env.SLACK_CLIENT_ID!);
  slackAuthUrl.searchParams.set('scope', 'incoming-webhook');
  slackAuthUrl.searchParams.set('redirect_uri', process.env.SLACK_REDIRECT_URI!.trim());
  slackAuthUrl.searchParams.set('state', stateToken);

  // Redirect to Slack
  res.redirect(slackAuthUrl.toString());
});

/**
 * GET /slack/oauth/callback
 * Handles the callback from Slack after the user authorizes the app.
 * Exchanges the code for an access token and stores the incoming webhook URL.
 */
app.get('/slack/oauth/callback', async (req, res) => {
  const { code, state } = req.query;

  // Validate parameters
  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  // Retrieve the senderId from Redis using the state token
  const senderId = await redisConnection.get(`oauth_state:${state}`);
  // Delete the state token from Redis (one-time use)
  await redisConnection.del(`oauth_state:${state}`);

  if (!senderId) {
    return res.status(400).json({ error: 'Invalid or expired state parameter' });
  }

  try {
    // Exchange the code for an access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code: code,
        redirect_uri: process.env.SLACK_REDIRECT_URI!.trim(),
      }),
    });

    const tokenData = (await tokenResponse.json()) as SlackOAuthResponse;

    if (!tokenData.ok) {
      console.error ('Slack OAuth error:', tokenData);
      return res.status(500).json({ error: 'Failed to obtain access token from Slack' });
    }

    // Extract the incoming webhook URL
    const webhookUrl = tokenData.incoming_webhook?.url;
    if (!webhookUrl) {
      console.error('No incoming webhook URL in Slack response:', tokenData);
      return res.status(500).json({ error: 'Slack did not return an incoming webhook URL' });
    }

    // Optional: also extract other fields like team name, channel, etc.
    const teamName = tokenData.team?.name;
    const channelName = tokenData.incoming_webhook?.channel;
    const channelId = tokenData.incoming_webhook?.channel_id;

    // Upsert the Slack connection for this sender
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upsertQuery = `
        INSERT INTO slack_connections (
          sender_id, access_token, webhook_url, channel, team_name, connected_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (sender_id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          webhook_url = EXCLUDED.webhook_url,
          channel = EXCLUDED.channel,
          team_name = EXCLUDED.team_name,
          connected_at = NOW()
      `;
      const upsertValues = [
        senderId,
        tokenData.access_token,
        webhookUrl,
        channelName || null,
        teamName || null,
      ];
      await client.query(upsertQuery, upsertValues);
      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database error while upserting Slack connection:', dbError);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }

    // Redirect to a success page or return JSON
    // For simplicity, we'll return a JSON success message.
    // In a real app, you might redirect to a frontend page.
    res.json({
      status: 'success',
      message: 'Slack connection successful',
      senderId: senderId,
      teamName: teamName,
      channel: channelName,
    });
  } catch (error) {
    console.error('Error during Slack OAuth callback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PATCH /emails/:id/star — toggles is_starred
app.patch('/emails/:id/star', auth, async (req, res) => {
  const { id } = req.params;

  // Validate id is a UUID
  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current email
    const selectQuery = `SELECT * FROM emails WHERE id = $1 AND sender_id = $2`;
    const selectResult = await client.query(selectQuery, [id, req.senderId]);
    if (selectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Email not found' });
    }
    const email = selectResult.rows[0];

    // Toggle is_starred
    const newIsStarred = !email.is_starred;

    // Update email
    const updateQuery = `
      UPDATE emails
      SET is_starred = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const updateValues = [newIsStarred, id];
    const updateResult = await client.query(updateQuery, updateValues);
    const updatedEmail = updateResult.rows[0];

    await client.query('COMMIT');

    // Re-index in Elasticsearch (non-blocking)
    indexEmail(updatedEmail).catch(err => {
      console.error(`Failed to re-index email ${updatedEmail.id} after star toggle:`, err);
    });

    return res.status(200).json(updatedEmail);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error toggling star:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /emails/:id/archive — sets is_archived = true
app.patch('/emails/:id/archive', auth, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current email
    const selectQuery = `SELECT * FROM emails WHERE id = $1 AND sender_id = $2`;
    const selectResult = await client.query(selectQuery, [id, req.senderId]);
    if (selectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Email not found' });
    }
    const email = selectResult.rows[0];

    // Set is_archived to true
    const newIsArchived = true;

    // Update email
    const updateQuery = `
      UPDATE emails
      SET is_archived = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const updateValues = [newIsArchived, id];
    const updateResult = await client.query(updateQuery, updateValues);
    const updatedEmail = updateResult.rows[0];

    await client.query('COMMIT');

    // Re-index in Elasticsearch (non-blocking)
    indexEmail(updatedEmail).catch(err => {
      console.error(`Failed to re-index email ${updatedEmail.id} after archive:`, err);
    });

    return res.status(200).json(updatedEmail);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error archiving email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /emails/:id/unarchive — sets is_archived = false
app.patch('/emails/:id/unarchive', auth, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current email
    const selectQuery = `SELECT * FROM emails WHERE id = $1 AND sender_id = $2`;
    const selectResult = await client.query(selectQuery, [id, req.senderId]);
    if (selectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Email not found' });
    }
    const email = selectResult.rows[0];

    // Set is_archived to false
    const newIsArchived = false;

    // Update email
    const updateQuery = `
      UPDATE emails
      SET is_archived = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const updateValues = [newIsArchived, id];
    const updateResult = await client.query(updateQuery, updateValues);
    const updatedEmail = updateResult.rows[0];

    await client.query('COMMIT');

    // Re-index in Elasticsearch (non-blocking)
    indexEmail(updatedEmail).catch(err => {
      console.error(`Failed to re-index email ${updatedEmail.id} after unarchive:`, err);
    });

    return res.status(200).json(updatedEmail);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error unarchiving email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /emails/:id — deletes the row from Postgres. If the email's bullmq_job_id still exists as a delayed/waiting job in the queue, remove that job too.
app.delete('/emails/:id', auth, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the email to check for bullmq_job_id
    const selectQuery = `SELECT bullmq_job_id FROM emails WHERE id = $1 AND sender_id = $2`;
    const selectResult = await client.query(selectQuery, [id, req.senderId]);
    if (selectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Email not found' });
    }
    const { bullmq_job_id } = selectResult.rows[0];

    // Delete the email
    const deleteQuery = `DELETE FROM emails WHERE id = $1`;
    await client.query(deleteQuery, [id]);

    // If there is a bullmq_job_id, try to remove the job from the queue
    if (bullmq_job_id) {
      try {
        const job = await emailQueue.getJob(bullmq_job_id);
        if (job) {
          await job.remove();
        }
      } catch (jobError) {
        // If the job is not found or already processed, we just continue
        console.warn(`Could not remove job ${bullmq_job_id} from queue:`, jobError instanceof Error ? jobError.message : String(jobError));
      }
    }

    await client.query('COMMIT');

    // Delete from Elasticsearch (non-blocking)
    try {
      await esClient.delete({
        index: 'emails',
        id,
      });
    } catch (esError) {
      console.error(`Failed to delete email ${id} from Elasticsearch:`, esError);
    }

    return res.status(200).json({ message: 'Email deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /emails/:id/resend — "Send Again": look up the original email by id, create a NEW email row (new id, same recipient/subject/content/senderId, status='pending', scheduledAt = now), enqueue a new BullMQ job with delay=0 using the same pattern as POST /schedule, return the new email record.
app.post('/emails/:id/resend', auth, async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the original email
    const selectQuery = `SELECT * FROM emails WHERE id = $1 AND sender_id = $2`;
    const selectResult = await client.query(selectQuery, [id, req.senderId]);
    if (selectResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Original email not found' });
    }
    const originalEmail = selectResult.rows[0];

    // Guard against emails created before the recipient column migration (null recipient/subject/content)
    if (!originalEmail.recipient || !originalEmail.subject || !originalEmail.content) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot resend: original email is missing required data (recipient/subject/content). This email may have been created before recipient tracking was added.' });
    }

    // Generate a new idempotency key based on recipient, subject, and scheduledAt (now)
    const scheduledAt = new Date().toISOString();
    const idempotencyKey = generateIdempotencyKey(originalEmail.recipient, originalEmail.subject, scheduledAt);

    // Insert the new email record with status='pending'
    const insertEmailQuery = `
      INSERT INTO emails (sender_id, recipient, subject, content, scheduled_at, status, idempotency_key, is_starred, is_archived)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const emailValues = [
      originalEmail.sender_id,
      originalEmail.recipient,
      originalEmail.subject,
      originalEmail.content, // Note: the original email has 'content' but we stored as 'content'? Wait, in the select we have 'content' column.
      scheduledAt,
      'pending',
      idempotencyKey,
      false, // is_starred,
      false, // is_archived
    ];
    const emailResult = await client.query(insertEmailQuery, emailValues);
    const newEmail = emailResult.rows[0];

    // Index the new email record in Elasticsearch (non-blocking)
    indexEmail(newEmail).catch(err => {
      console.error(`Failed to index new resent email ${newEmail.id}:`, err);
    });

    // Calculate delay for BullMQ job: scheduledAt - now
    const now = new Date();
    const delayMs = new Date(scheduledAt).getTime() - now.getTime();
    // If scheduledAt is in the past, set delay to 0 (send immediately)
    const delay = delayMs > 0 ? delayMs : 0;

    // Add a job to the BullMQ queue with jobId = idempotencyKey (for deduplication)
    const job = await emailQueue.add(
      'send-email', // job name
      {
        emailId: newEmail.id,
        recipient: newEmail.recipient,
        subject: newEmail.subject,
        body: newEmail.content,
        // We don't need to pass the entire email record, just the id and the content
      },
      {
        jobId: idempotencyKey, // This ensures that if a job with the same idempotencyKey already exists, it won't be added again
        delay, // delay in milliseconds
        // Optional: you can set attempts, backoff, etc.
        // We'll keep it simple for now
      }
    );

    // Update the email record with the BullMQ job ID
    const updateEmailQuery = `
      UPDATE emails
      SET bullmq_job_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sender_id, recipient, subject, content, scheduled_at, sent_at, status, idempotency_key, bullmq_job_id, created_at, updated_at, is_starred, is_archived
    `;
    const updateValues = [job.id, newEmail.id];
    const updateResult = await client.query(updateEmailQuery, updateValues);
    const updatedEmail = updateResult.rows[0];

    await client.query('COMMIT');

    return res.status(201).json(newEmail);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error resending email:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /senders/ensure that accepts { email, name } in the body, and does an INSERT ... ON CONFLICT (email) DO UPDATE (upsert) into the senders table, returning the sender's id.
app.post('/senders/ensure', authEmailOnly, async (req, res) => {
  const { name } = req.body; // email from token
  const email = req.userEmail;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert the sender
    const upsertQuery = `
      INSERT INTO senders (email, name)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            updated_at = NOW()
      RETURNING id, email, name
    `;
    const upsertValues = [email, name || null];
    const result = await client.query(upsertQuery, upsertValues);
    const sender = result.rows[0];

    await client.query('COMMIT');

    return res.status(200).json(sender);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error ensuring sender:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /senders/me/slack-status — returns whether Slack is connected for the current sender
app.get('/senders/me/slack-status', auth, async (req, res) => {
  const senderId = req.senderId;

  if (!senderId) {
    return res.status(400).json({ error: 'Missing senderId' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT 1 FROM slack_connections WHERE sender_id = $1',
      [senderId]
    );

    const connected = result.rowCount > 0;
    return res.status(200).json({ connected });
  } catch (error) {
    console.error('Error checking Slack connection status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});


// Basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// BullMQ Board Setup
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

// Mount the board
app.use('/admin/queues', serverAdapter.getRouter());

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
// TODO: Fix route ordering - search must come before :id parameter
});