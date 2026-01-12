import { z } from "zod";

const schema = z.object({
  PUBLIC_APP_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  COOKIE_NAME: z.string().min(1).default("coldmail_session"),
  DATABASE_URL: z.string().min(1),
  MAILSTACK_SCRIPT: z.string().optional(),
  MAILSTACK_ADDON_SCRIPT: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  DEFAULT_SMTP_LOCAL_ADDRESS: z.string().optional(),
  // Email used for Let's Encrypt ACME account registration (mailstack-addon.sh)
  MAILSTACK_ACME_EMAIL: z.string().email().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  SEND_TICK_SECONDS: z.coerce.number().int().positive().default(10),
  IMAP_POLL_MINUTES: z.coerce.number().int().positive().default(5),
  // Global pacing between sends per mailbox (seconds). Helps avoid burst sending.
  SEND_GAP_MIN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  SEND_GAP_MAX_SECONDS: z.coerce.number().int().nonnegative().default(180),
  // TEMP: allow skipping TLS cert verification for SMTP (hostname mismatch etc.)
  SMTP_TLS_SKIP_VERIFY: z.coerce.boolean().default(false),

  // --- Lead email verification (ping-email) ---
  PING_EMAIL_ENABLED: z.coerce.boolean().default(false),
  PING_EMAIL_FQDN: z.string().optional(),
  PING_EMAIL_SENDER: z.string().email().optional(),
  PING_EMAIL_PORT: z.coerce.number().int().positive().default(25),
  PING_EMAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PING_EMAIL_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PING_EMAIL_IGNORE_SMTP_VERIFY: z.coerce.boolean().default(false),
  PING_EMAIL_DEBUG: z.coerce.boolean().default(false),


  // --- Mailbox monitoring (Upgrade C) ---
  AUTO_HEALTHCHECK_ENABLED: z.coerce.boolean().default(true),
  HEALTHCHECK_POLL_MINUTES: z.coerce.number().int().positive().default(60),
  HEALTHCHECK_STALE_HOURS: z.coerce.number().int().positive().default(12),

  // --- Domain DNS monitoring (Upgrade D) ---
  AUTO_DOMAIN_DNSCHECK_ENABLED: z.coerce.boolean().default(true),
  DOMAIN_DNSCHECK_POLL_MINUTES: z.coerce.number().int().positive().default(720), // 12h
  DOMAIN_DNSCHECK_STALE_HOURS: z.coerce.number().int().positive().default(24),

  // Warmup suite
  AUTO_WARMUP_ENABLED: z.coerce.boolean().default(true),
  // Enable verbose warmup logs in worker.
  WARMUP_DEBUG: z.coerce.boolean().default(false),
  WARMUP_POLL_MINUTES: z.coerce.number().int().positive().default(10),
  WARMUP_SEEDCHECK_POLL_MINUTES: z.coerce.number().int().positive().default(10),
  WARMUP_STALE_MINUTES: z.coerce.number().int().positive().default(30),
  // If true, when a warmup email is detected in Spam/Junk of a seed inbox, attempt to move it to INBOX.
  WARMUP_SEED_RESCUE_SPAM: z.coerce.boolean().default(false),
  WARMUP_SEED_RESCUE_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(2500),
  WARMUP_SEED_RESCUE_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  WARMUP_SEED_RESCUE_BACKOFF_MIN: z.coerce.number().int().positive().default(10),
  WARMUP_SEED_RESCUE_BACKOFF_MAX_MIN: z.coerce.number().int().positive().default(60),

  // Seed engagement simulation (enterprise warmup)
  // If true, the seed checker will simulate engagement actions like opening (mark as seen) and starring.
  WARMUP_SEED_ENGAGE: z.coerce.boolean().default(false),
  // Probabilities are 0..1
  WARMUP_SEED_ENGAGE_OPEN_RATE: z.coerce.number().min(0).max(1).default(0.85),
  WARMUP_SEED_ENGAGE_STAR_RATE: z.coerce.number().min(0).max(1).default(0.35),
  // Optional: after moving spam to inbox, sometimes archive the message to reduce inbox clutter.
  WARMUP_SEED_ENGAGE_ARCHIVE_RATE: z.coerce.number().min(0).max(1).default(0.15),

  // Seed auto-reply (requires SMTP config on the seed inbox record)
  WARMUP_SEED_AUTOREPLY: z.coerce.boolean().default(false),
  WARMUP_SEED_AUTOREPLY_RATE: z.coerce.number().min(0).max(1).default(0.30),
  WARMUP_SEED_AUTOREPLY_MIN_DELAY_MIN: z.coerce.number().int().nonnegative().default(5),
  WARMUP_SEED_AUTOREPLY_MAX_DELAY_MIN: z.coerce.number().int().nonnegative().default(35),

  // Warmup AI (template generation / rewriting)
  WARMUP_AI_ENABLED: z.coerce.boolean().default(false),
  AI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // --- Unified App Logging ---
  INTERNAL_LOG_TOKEN: z.string().optional(),
  APPLOG_DB: z.coerce.boolean().default(true),
  APPLOG_LEVEL: z.string().default("info"),
  PRISMA_SLOW_MS: z.coerce.number().int().positive().default(150),
  PRISMA_LOG_WRITES: z.coerce.boolean().default(true),
  PRISMA_LOG_READS: z.coerce.boolean().default(false),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export const env = schema.parse({
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  COOKIE_NAME: process.env.COOKIE_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  DEFAULT_SMTP_LOCAL_ADDRESS: process.env.DEFAULT_SMTP_LOCAL_ADDRESS,
  MAILSTACK_ACME_EMAIL: process.env.MAILSTACK_ACME_EMAIL,
  WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
  SEND_TICK_SECONDS: process.env.SEND_TICK_SECONDS,
  IMAP_POLL_MINUTES: process.env.IMAP_POLL_MINUTES,
  SEND_GAP_MIN_SECONDS: process.env.SEND_GAP_MIN_SECONDS,
  SEND_GAP_MAX_SECONDS: process.env.SEND_GAP_MAX_SECONDS,
  SMTP_TLS_SKIP_VERIFY: process.env.SMTP_TLS_SKIP_VERIFY,

  PING_EMAIL_ENABLED: process.env.PING_EMAIL_ENABLED,
  PING_EMAIL_FQDN: process.env.PING_EMAIL_FQDN,
  PING_EMAIL_SENDER: process.env.PING_EMAIL_SENDER,
  PING_EMAIL_PORT: process.env.PING_EMAIL_PORT,
  PING_EMAIL_TIMEOUT_MS: process.env.PING_EMAIL_TIMEOUT_MS,
  PING_EMAIL_ATTEMPTS: process.env.PING_EMAIL_ATTEMPTS,
  PING_EMAIL_IGNORE_SMTP_VERIFY: process.env.PING_EMAIL_IGNORE_SMTP_VERIFY,
  PING_EMAIL_DEBUG: process.env.PING_EMAIL_DEBUG,


  AUTO_HEALTHCHECK_ENABLED: process.env.AUTO_HEALTHCHECK_ENABLED,
  HEALTHCHECK_POLL_MINUTES: process.env.HEALTHCHECK_POLL_MINUTES,
  HEALTHCHECK_STALE_HOURS: process.env.HEALTHCHECK_STALE_HOURS,

  AUTO_DOMAIN_DNSCHECK_ENABLED: process.env.AUTO_DOMAIN_DNSCHECK_ENABLED,
  DOMAIN_DNSCHECK_POLL_MINUTES: process.env.DOMAIN_DNSCHECK_POLL_MINUTES,
  DOMAIN_DNSCHECK_STALE_HOURS: process.env.DOMAIN_DNSCHECK_STALE_HOURS,

  // Warmup suite
  AUTO_WARMUP_ENABLED: process.env.AUTO_WARMUP_ENABLED,
  WARMUP_DEBUG: process.env.WARMUP_DEBUG,
  WARMUP_POLL_MINUTES: process.env.WARMUP_POLL_MINUTES,
  WARMUP_SEEDCHECK_POLL_MINUTES: process.env.WARMUP_SEEDCHECK_POLL_MINUTES,
  WARMUP_STALE_MINUTES: process.env.WARMUP_STALE_MINUTES,
  WARMUP_SEED_RESCUE_SPAM: process.env.WARMUP_SEED_RESCUE_SPAM,

  WARMUP_SEED_ENGAGE: process.env.WARMUP_SEED_ENGAGE,
  WARMUP_SEED_ENGAGE_OPEN_RATE: process.env.WARMUP_SEED_ENGAGE_OPEN_RATE,
  WARMUP_SEED_ENGAGE_STAR_RATE: process.env.WARMUP_SEED_ENGAGE_STAR_RATE,
  WARMUP_SEED_ENGAGE_ARCHIVE_RATE: process.env.WARMUP_SEED_ENGAGE_ARCHIVE_RATE,

  WARMUP_SEED_AUTOREPLY: process.env.WARMUP_SEED_AUTOREPLY,
  WARMUP_SEED_AUTOREPLY_RATE: process.env.WARMUP_SEED_AUTOREPLY_RATE,
  WARMUP_SEED_AUTOREPLY_MIN_DELAY_MIN: process.env.WARMUP_SEED_AUTOREPLY_MIN_DELAY_MIN,
  WARMUP_SEED_AUTOREPLY_MAX_DELAY_MIN: process.env.WARMUP_SEED_AUTOREPLY_MAX_DELAY_MIN,

  WARMUP_AI_ENABLED: process.env.WARMUP_AI_ENABLED,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,

  INTERNAL_LOG_TOKEN: process.env.INTERNAL_LOG_TOKEN,
  APPLOG_DB: process.env.APPLOG_DB,
  APPLOG_LEVEL: process.env.APPLOG_LEVEL,
  PRISMA_SLOW_MS: process.env.PRISMA_SLOW_MS,
  PRISMA_LOG_WRITES: process.env.PRISMA_LOG_WRITES,
  PRISMA_LOG_READS: process.env.PRISMA_LOG_READS,
  LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS,
});