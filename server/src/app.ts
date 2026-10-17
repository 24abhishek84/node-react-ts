import express, { Express } from 'express';
import { openDb } from './db';
import { createLogger } from './logger';
import { createEventBus, registerAuditSubscriber } from './events';
import { cors, requestId, requireAuth, notFoundHandler, errorHandler } from './middleware/index';
import { createAuthService } from './modules/auth/auth.service';
import { authRoutes } from './modules/auth/auth.routes';
import { createTaskService } from './modules/tasks/tasks.service';
import { taskRoutes } from './modules/tasks/tasks.routes';
import type { Config } from './config';
import type { Logger } from './logger';
import type { Database } from './db';
import { sql } from 'drizzle-orm';

interface AppCreateOptions {
  logger?: Logger;
}

export interface AppResult {
  app: Express;
  db: Database;
  close: () => Promise<void>;
}

export async function createApp(config: Config, { logger = createLogger() }: AppCreateOptions = {}): Promise<AppResult> {
  const db = await openDb(config.DATABASE_URL, { schema: config.DB_SCHEMA });
  const bus = createEventBus(logger);
  registerAuditSubscriber(bus, db, logger);

  const authService = createAuthService({ db, config, bus });
  const taskService = createTaskService({ db, bus });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId(logger), cors(config.CORS_ORIGIN), express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
      res.status(503).json({ status: 'error', error: 'Database unavailable' });
    }
  });
  app.use('/api/auth', authRoutes({ authService, config }));
  app.use('/api/tasks', requireAuth(config.JWT_SECRET), taskRoutes({ taskService }));

  app.use(notFoundHandler, errorHandler(logger));
  return { app, db, close: async () => {} };
}
