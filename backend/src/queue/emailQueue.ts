import dotenv from 'dotenv';
dotenv.config();
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Load environment variables
// Create a Redis connection
const redisConnection = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD || undefined, // ioredis treats empty string as password, so we use undefined if empty
  tls: {},
  // Optional: you can add retry strategies, etc.
});

// Create and export the BullMQ queue named 'email-send'
export const emailQueue = new Queue('email-send', {
  connection: redisConnection,
});

// Export the redisConnection for potential reuse (e.g., rate limiting in worker)
export { redisConnection };

// Optional: handle connection events for debugging
redisConnection.on('connect', () => {
  console.log('Connected to Redis');
});

redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

export default emailQueue;