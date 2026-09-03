import dotenv from 'dotenv';
dotenv.config();
import { esClient } from './elasticsearchClient';

/**
 * Indexes an email record in Elasticsearch.
 * Uses the email's id as the document _id for upsert behavior.
 * If indexing fails, logs the error but does not throw (Elasticsearch is not a critical path).
 *
 * @param email - The email object to index. Expected to have at least: id, recipient, subject, status, scheduled_at, sent_at, sender_id.
 */
export async function indexEmail(email: any): Promise<void> {
  try {
    // We only index if we have an id; otherwise, we cannot upsert.
    if (!email.id) {
      console.warn('Attempted to index an email without an id. Skipping.');
      return;
    }

    // Prepare the document body with the fields we want to index.
    // We include only the fields we defined in the mapping.
    const doc = {
      recipient: email.recipient,
      subject: email.subject,
      content: email.content,
      status: email.status,
      scheduled_at: email.scheduled_at,
      sent_at: email.sent_at,
      sender_id: email.sender_id,
      is_starred: email.is_starred,
      is_archived: email.is_archived,
    };

    // Index the document (upsert by id)
    await esClient.index({
      index: 'emails',
      id: email.id,
      body: doc,
      // Note: We are not specifying refresh policy; we can leave it as default.
    });

    // Optionally log success at debug level
    // console.debug(`Indexed email ${email.id} in Elasticsearch.`);
  } catch (error) {
    // Log the error but do not re-throw - we don't want indexing failures to block core operations.
    console.error(`Failed to index email ${email.id} in Elasticsearch:`, error);
  }
}