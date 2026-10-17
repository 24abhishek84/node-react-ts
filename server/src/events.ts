import { EventEmitter } from 'node:events';
import type { Logger } from './logger';
import type { Database } from './db';

export interface EventPayload {
  userId?: number | null;
  [key: string]: unknown;
}

export type EventBus = EventEmitter;

export function createEventBus(logger: Logger): EventBus {
  const bus = new EventEmitter();
  bus.on('error', (err) => {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('event bus error', { err: error });
  });
  return bus;
}

export function registerAuditSubscriber(bus: EventBus, db: Database, logger: Logger): void {
  const events = ['task.created', 'task.updated', 'task.deleted', 'user.registered', 'user.login'];
  for (const event of events) {
    bus.on(event, async (payload: EventPayload) => {
      try {
        await db.query(
          'INSERT INTO audit_log (user_id, event, payload) VALUES ($1, $2, $3)',
          [payload.userId ?? null, event, JSON.stringify(payload)]
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error('audit write failed', { event, err: error });
      }
    });
  }
}
