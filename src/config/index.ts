import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  SESSION_ENCRYPTION_KEY: z.string().min(32),
  API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
  WARMUP_DAY1_LIMIT: z.coerce.number().default(15),
  // Total warmup duration in days. The daily limit ramps from WARMUP_DAY1_LIMIT
  // up to WARMUP_MAX_DAILY across this many days, then holds at the target.
  // Default 15. Can be overridden per-account via Account.warmupTotalDays.
  WARMUP_TOTAL_DAYS: z.coerce.number().int().min(2).default(15),
  // Deprecated: the ramp growth is now derived from WARMUP_TOTAL_DAYS so the
  // curve always spans the configured number of days. Kept for .env compatibility.
  WARMUP_GROWTH_FACTOR: z.coerce.number().default(1.35),
  WARMUP_MAX_DAILY: z.coerce.number().default(400),
  WARMUP_INACTIVITY_RESET_HOURS: z.coerce.number().default(72),
  SAFE_MSGS_PER_HOUR: z.coerce.number().default(30),
  SAFE_REPLY_RATE_MIN: z.coerce.number().default(0.30),
  SAFE_BLOCK_RATE_MAX: z.coerce.number().default(0.02),
  SAFE_NEW_CONTACTS_PER_DAY: z.coerce.number().default(20),
  SAFE_IDENTICAL_MSGS_PER_HOUR: z.coerce.number().default(5),
  MAX_CONCURRENT_CONNECTIONS: z.coerce.number().default(10),
  RECONNECT_BATCH_SIZE: z.coerce.number().default(10),
  RECONNECT_BATCH_DELAY_MS: z.coerce.number().default(5000),
  ALERT_WEBHOOK_URL: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

export function loadConfig(): Config {
  if (config) return config;
  config = envSchema.parse(process.env);
  return config;
}

export function getConfig(): Config {
  if (!config) throw new Error('Config not loaded. Call loadConfig() first.');
  return config;
}
