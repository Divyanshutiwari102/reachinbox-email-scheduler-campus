import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';

// Create a PostgreSQL connection pool (reusing the same config as in pool.ts)
// We could import the pool from '../db/pool', but to avoid circular dependencies and
// because this service might be used in multiple places, we create a new pool.
// However, note that creating multiple pools is not ideal. Alternatively, we can
// import the existing pool. Let's do that to reuse the same pool.

import pool from '../db/pool';

/**
 * Sends a rate limit notification to Slack for a given sender.
 * Looks up the Slack connection for the sender in the database.
 * If found, posts a message to the webhook URL.
 * If not found, logs a debug message and returns silently.
 *
 * @param senderId - The UUID of the sender (from the senders table)
 * @param details - An object containing details about the rate limit hit
 */
export async function notifySlackRateLimitHit(
  senderId: string,
  details: {
    senderIdString: string; // The senderId as a string (for display)
    count: number; // The current count that exceeded the limit
    max: number; // The maximum allowed per hour
    hourKey: string; // The hour key (YYYY-MM-DD-HH) in UTC
    emailId: string; // The email ID that was rescheduled
  }
) {
  try {
    // Look up the Slack connection for this sender
    const result = await pool.query(
      'SELECT webhook_url FROM slack_connections WHERE sender_id = $1',
      [senderId]
    );

    if (result.rowCount === 0) {
      // No Slack connection for this sender - log and return silently
      console.debug(`No Slack connection found for sender ${senderId}. Skipping notification.`);
      return;
    }

    const webhookUrl = result.rows[0].webhook_url;
    if (!webhookUrl) {
      console.debug(`Slack connection for sender ${senderId} has no webhook URL.`);
      return;
    }

    // Construct the notification message
    const message = `⚠️ Rate limit hit for sender \`${details.senderIdString}\` ` +
      `(count: ${details.count}/${details.max}) in hour ${details.hourKey}. ` +
      `Email \`${details.emailId}\` has been rescheduled to the next hour.`;

    // Send the POST request to the Slack webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      console.error(
        `Failed to send Slack notification for sender ${senderId}: ` +
        `HTTP ${response.status} - ${await response.text()}`
      );
    } else {
      console.log(`Slack notification sent successfully for sender ${senderId}`);
    }
  } catch (error) {
    // Log the error but do not throw - we don't want notifications to break the worker
    console.error(`Error sending Slack notification for sender ${senderId}:`, error);
  }
}