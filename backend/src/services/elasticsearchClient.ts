import dotenv from 'dotenv';
dotenv.config();
import { Client } from '@elastic/elasticsearch';

// Elasticsearch host from environment, default to localhost:9201 (mapped from container's 9200)
const ES_HOST = process.env.ES_HOST || 'http://localhost:9201';

// Initialize the Elasticsearch client
export const esClient = new Client({ node: ES_HOST });

/**
 * Ensures the "emails" index exists with the required mappings.
 * If the index does not exist, it creates it.
 * If it exists, it does nothing (we could check mappings and update if needed, but for simplicity we just create if missing).
 * This function is safe to call multiple times.
 */
export async function ensureEmailsIndexExists(): Promise<void> {
  try {
    // Check if the index already exists
    const indexExists = await esClient.indices.exists({ index: 'emails' });
    if (indexExists) {
      console.log('Elasticsearch index "emails" already exists.');
      return;
    }

    // Create the index with mappings
    await esClient.indices.create({
      index: 'emails',
      body: {
        mappings: {
          properties: {
            recipient: { type: 'keyword' },
            subject: { type: 'text' },
            content: { type: 'text' },
            status: { type: 'keyword' },
            scheduled_at: { type: 'date' },
            sent_at: { type: 'date' },
            sender_id: { type: 'keyword' },
          }
        }
      }
    });
    console.log('Elasticsearch index "emails" created successfully.');
  } catch (error) {
    // Log the error but do not throw - we don't want to block server startup if ES is down
    console.error('Failed to ensure Elasticsearch index exists:', error);
    // We do not re-throw because Elasticsearch is not a critical dependency for core functionality.
  }
}