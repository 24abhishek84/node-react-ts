import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pkg from 'pg';
import * as schema from './schema';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool, types } = pkg as typeof import('pg');
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

export type Database = ReturnType<typeof drizzle>;

interface OpenDbOptions {
  schema?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '..', '..', 'server', 'drizzle');

export async function openDb(connectionString: string, { schema: schemaName }: OpenDbOptions = {}): Promise<Database> {
  let pool: InstanceType<typeof Pool>;

  if (schemaName) {
    const admin = new Pool({ connectionString, max: 1 });
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await admin.end();

    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      application_name: 'taskflow',
      options: `-c search_path=${schemaName}`,
    });
  } else {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      application_name: 'taskflow',
    });
  }

  pool.on('error', (err) => console.error('idle pg client error', err.message));

  const db = drizzle(pool, { schema });

  // Run migrations
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    console.warn('Migration warning:', (err as Error).message);
    // Fallback to creating tables manually if migration fails
    await createTablesIfNotExists(db);
  }

  return db;
}

async function createTablesIfNotExists(db: Database) {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
        priority SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
        due_date DATE,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status, id DESC);

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked BOOLEAN NOT NULL DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        event TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch (err) {
    // Tables already exist
  }
}
