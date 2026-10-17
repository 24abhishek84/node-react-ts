import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).default(3000),
  DATABASE_URL: z.string().default('postgres://taskflow:taskflow@localhost:5432/taskflow'),
  DB_SCHEMA: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return Object.freeze(cfg);
}
