import { and, eq, lt, ilike, desc, count, sql } from 'drizzle-orm';
import { conflict, notFound } from '../../errors';
import type { Database } from '../../db';
import type { EventBus } from '../../events';
import { tasks } from '../../schema';

export interface Task {
  id: number;
  userId: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: number;
  dueDate: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  dueDate?: string;
}

export interface ListOptions {
  status?: string;
  search?: string;
  limit: number;
  cursor?: number;
}

export interface ListResult {
  items: Task[];
  nextCursor: number | null;
}

export interface TaskStats {
  todo: number;
  in_progress: number;
  done: number;
}

export interface TaskService {
  get(userId: number, id: number): Promise<Task>;
  create(userId: number, input: Partial<Task>): Promise<Task>;
  list(userId: number, options: ListOptions): Promise<ListResult>;
  update(userId: number, id: number, expectedVersion: number, patch: TaskPatch): Promise<Task>;
  remove(userId: number, id: number): Promise<void>;
  stats(userId: number): Promise<TaskStats>;
  bulkSetStatus(userId: number, ids: number[], status: string): Promise<number>;
  exportRows(userId: number): AsyncGenerator<Task>;
}

interface TaskServiceOptions {
  db: Database;
  bus: EventBus;
}

export function createTaskService({ db, bus }: TaskServiceOptions): TaskService {
  const get = async (userId: number, id: number): Promise<Task> => {
    const result = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .limit(1);
    if (!result[0]) throw notFound('Task');
    return mapTaskRow(result[0]);
  };

  return {
    get,

    async create(userId: number, input: Partial<Task>): Promise<Task> {
      const result = await db
        .insert(tasks)
        .values({
          userId,
          title: input.title!,
          description: input.description ?? '',
          priority: input.priority ?? 2,
          dueDate: input.dueDate ?? null,
        })
        .returning();
      bus.emit('task.created', { userId, taskId: Number(result[0]!.id) });
      return mapTaskRow(result[0]!);
    },

    async list(userId: number, { status, search, limit, cursor }: ListOptions): Promise<ListResult> {
      const conditions = [eq(tasks.userId, userId)];
      if (status) conditions.push(eq(tasks.status, status));
      if (search) conditions.push(ilike(tasks.title, `%${search.replace(/[\\%_]/g, '\\$&')}%`));
      if (cursor) conditions.push(lt(tasks.id, cursor));

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: items.map(mapTaskRow),
        nextCursor: hasMore ? Number(items.at(-1)!.id) : null,
      };
    },

    async update(userId: number, id: number, expectedVersion: number, patch: TaskPatch): Promise<Task> {
      const updates: Record<string, unknown> = {};
      if (patch.title !== undefined) updates.title = patch.title;
      if (patch.description !== undefined) updates.description = patch.description;
      if (patch.status !== undefined) updates.status = patch.status;
      if (patch.priority !== undefined) updates.priority = patch.priority;
      if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate;

      if (Object.keys(updates).length === 0) return get(userId, id);

      const result = await db
        .update(tasks)
        .set({
          ...updates,
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.userId, userId),
            eq(tasks.version, expectedVersion)
          )
        )
        .returning();

      if (!result[0]) {
        await get(userId, id);
        throw conflict('Task was modified by someone else', 'VERSION_CONFLICT');
      }
      bus.emit('task.updated', {
        userId,
        taskId: id,
        fields: Object.keys(patch).filter((k) => patch[k as keyof TaskPatch] !== undefined),
      });
      return mapTaskRow(result[0]);
    },

    async remove(userId: number, id: number): Promise<void> {
      const result = await db
        .delete(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
        .returning();
      if (result.length === 0) throw notFound('Task');
      bus.emit('task.deleted', { userId, taskId: id });
    },

    async stats(userId: number): Promise<TaskStats> {
      const rows = await db
        .select({
          status: tasks.status,
          count: count(),
        })
        .from(tasks)
        .where(eq(tasks.userId, userId))
        .groupBy(tasks.status);

      const stats: TaskStats = { todo: 0, in_progress: 0, done: 0 };
      for (const row of rows) {
        stats[row.status as keyof TaskStats] = row.count;
      }
      return stats;
    },

    async bulkSetStatus(userId: number, ids: number[], status: string): Promise<number> {
      let changed = 0;
      for (const id of new Set(ids)) {
        const result = await db
          .update(tasks)
          .set({
            status,
            version: sql`${tasks.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
          .returning();
        if (result.length === 0) throw notFound('One or more tasks');
        changed += result.length;
      }
      return changed;
    },

    async *exportRows(userId: number): AsyncGenerator<Task> {
      let cursor = Number.MAX_SAFE_INTEGER;
      for (;;) {
        const rows = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.userId, userId), lt(tasks.id, cursor)))
          .orderBy(desc(tasks.id))
          .limit(500);
        if (rows.length === 0) return;
        yield* rows.map(mapTaskRow);
        cursor = Number(rows.at(-1)!.id);
      }
    },
  };
}

function mapTaskRow(row: {
  id: number;
  userId: number;
  title: string;
  description: string;
  status: string;
  priority: number | null;
  dueDate: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority ?? 2,
    dueDate: row.dueDate,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
