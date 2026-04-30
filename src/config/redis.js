// src/config/redis.js
// Upstash Redis client (serverless, HTTP-based)

const { Redis } = require('@upstash/redis');
const logger = require('./logger');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Test connection on startup
(async () => {
  try {
    await redis.ping();
    logger.info('Upstash Redis connected');
  } catch (err) {
    logger.error('Redis error', { error: err.message });
  }
})();

// Helper: set a key with TTL (seconds)
redis.setEx = async (key, ttl, value) => {
  return redis.set(key, value, { ex: ttl });
};

// FIX: Upstash Redis is HTTP-based — there is no connection to close.
// Add a no-op quit() so graceful shutdown doesn't crash.
if (typeof redis.quit !== 'function') {
  redis.quit = async () => {
    logger.info('Redis quit (Upstash HTTP — no-op)');
  };
}

module.exports = redis;
