import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { validate } from '../../middleware/index';
import { badRequest } from '../../errors';
import type { TaskService } from './tasks.service';

const status = z.enum(['todo', 'in_progress', 'done']);
const id = z.coerce.number().int().positive();

const createBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(1).max(3).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const updateBody = createBody.partial().extend({ status: status.optional() });
const listQuery = z.object({
  status: status.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: id.optional(),
});
const bulkBody = z.object({ ids: z.array(id).min(1).max(100), status });

const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;

interface TaskRoutesOptions {
  taskService: TaskService;
}

export function taskRoutes({ taskService }: TaskRoutesOptions) {
  const r = Router();

  r.get('/', validate({ query: listQuery }), async (req, res) => {
    res.json(await taskService.list(req.user!.id, req.valid!.query));
  });

  r.get('/stats', async (req, res) => res.json(await taskService.stats(req.user!.id)));

  r.get('/export.csv', async (req, res) => {
    res.set({ 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="tasks.csv"' });
    const rows = taskService.exportRows(req.user!.id);
    async function* lines() {
      yield 'id,title,status,priority,dueDate\n';
      for await (const t of rows) {
        yield [t.id, csvCell(t.title), t.status, t.priority, t.dueDate ?? ''].join(',') + '\n';
      }
    }
    await pipeline(Readable.from(lines()), res);
  });

  r.post('/bulk-status', validate({ body: bulkBody }), async (req, res) => {
    const changed = await taskService.bulkSetStatus(req.user!.id, req.valid!.body.ids, req.valid!.body.status);
    res.json({ changed });
  });

  r.post('/', validate({ body: createBody }), async (req, res) => {
    const task = await taskService.create(req.user!.id, req.valid!.body);
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  });

  r.get('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
    const task = await taskService.get(req.user!.id, req.valid!.params.id);
    res.set('etag', `"${task.version}"`).json(task);
  });

  r.patch('/:id', validate({ params: z.object({ id }), body: updateBody }), async (req, res) => {
    const match = /^"?(\d+)"?$/.exec(req.get('if-match') ?? '');
    if (!match) throw badRequest('If-Match header with task version is required');
    const task = await taskService.update(req.user!.id, req.valid!.params.id, Number(match[1]), req.valid!.body);
    res.set('etag', `"${task.version}"`).json(task);
  });

  r.delete('/:id', validate({ params: z.object({ id }) }), async (req, res) => {
    await taskService.remove(req.user!.id, req.valid!.params.id);
    res.sendStatus(204);
  });

  return r;
}
