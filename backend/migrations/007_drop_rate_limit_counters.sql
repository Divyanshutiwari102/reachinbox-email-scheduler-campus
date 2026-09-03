-- Drop unused rate_limit_counters table (rate limiting is handled by Redis)
DROP INDEX IF EXISTS idx_rate_limit_counters_sender_window;
DROP TABLE IF EXISTS rate_limit_counters;