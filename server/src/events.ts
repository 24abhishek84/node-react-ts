import { EventEmitter } from 'node:events';
import type { Logger } from './logger';
import type { Database } from './db';
import { auditLog } from './schema';

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
        await db.insert(auditLog).values({
          userId: payload.userId ?? null,
          event,
          payload,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error('audit write failed', { event, err: error });
      }
    });
  }
}
