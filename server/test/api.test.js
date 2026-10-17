import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

let ctx, base;
const schema = `test_${process.pid}_${Date.now()}`; // isolated per run, dropped afterwards

before(async () => {
  const config = loadConfig({ NODE_ENV: 'test', DB_SCHEMA: schema, PORT: '0', AUTH_RATE_LIMIT: '1000', ...(process.env.DATABASE_URL && { DATABASE_URL: process.env.DATABASE_URL }) });
  ctx = await createApp(config, { logger: createLogger({ silent: true }) });
  ctx.server = ctx.app.listen(0);
  await new Promise((r) => ctx.server.once('listening', r));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});

after(async () => {
  ctx.server.closeAllConnections();
  await new Promise((r) => ctx.server.close(r));
  await ctx.db.query(`DROP SCHEMA ${schema} CASCADE`);
  await ctx.close();
});

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, json, text };
}

let n = 0;
async function newUser() {
  const { json } = await api('/api/auth/register', { method: 'POST', body: { email: `u${++n}@x.com`, password: 'password123' } });
  return json;
}

test('register, login and reject bad credentials', async () => {
  const user = await newUser();
  assert.ok(user.accessToken && user.refreshToken);
  const ok = await api('/api/auth/login', { method: 'POST', body: { email: user.user.email, password: 'password123' } });
  assert.equal(ok.res.status, 200);
  const bad = await api('/api/auth/login', { method: 'POST', body: { email: user.user.email, password: 'wrongpass1' } });
  assert.equal(bad.res.status, 401);
  const dup = await api('/api/auth/register', { method: 'POST', body: { email: user.user.email, password: 'password123' } });
  assert.equal(dup.res.status, 409);
  assert.equal(dup.json.error.code, 'EMAIL_TAKEN');
});

test('refresh tokens rotate and reuse revokes the family', async () => {
  const { refreshToken } = await newUser();
  const first = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  assert.equal(first.res.status, 200);
  const reuse = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  assert.equal(reuse.res.status, 401);
  const newOneNowDead = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: first.json.refreshToken } });
  assert.equal(newOneNowDead.res.status, 401);
});

test('tasks require auth and validate input', async () => {
  assert.equal((await api('/api/tasks')).res.status, 401);
  const { accessToken: token } = await newUser();
  const bad = await api('/api/tasks', { method: 'POST', token, body: { title: '' } });
  assert.equal(bad.res.status, 400);
  assert.equal(bad.json.error.details[0].path, 'title');
});

test('optimistic locking returns 409 on stale version', async () => {
  const { accessToken: token } = await newUser();
  const { json: task } = await api('/api/tasks', { method: 'POST', token, body: { title: 'Write tests' } });
  const a = await api(`/api/tasks/${task.id}`, { method: 'PATCH', token, headers: { 'if-match': '"1"' }, body: { status: 'done' } });
  assert.equal(a.res.status, 200);
  assert.equal(a.json.version, 2);
  const stale = await api(`/api/tasks/${task.id}`, { method: 'PATCH', token, headers: { 'if-match': '"1"' }, body: { title: 'x' } });
  assert.equal(stale.res.status, 409);
  const missing = await api(`/api/tasks/${task.id}`, { method: 'PATCH', token, body: { title: 'x' } });
  assert.equal(missing.res.status, 400);
});

test("users cannot see each other's tasks", async () => {
  const a = await newUser();
  const b = await newUser();
  const { json: task } = await api('/api/tasks', { method: 'POST', token: a.accessToken, body: { title: 'secret' } });
  assert.equal((await api(`/api/tasks/${task.id}`, { token: b.accessToken })).res.status, 404);
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'DELETE', token: b.accessToken })).res.status, 404);
});

test('cursor pagination walks all items exactly once', async () => {
  const { accessToken: token } = await newUser();
  for (let i = 0; i < 7; i++) await api('/api/tasks', { method: 'POST', token, body: { title: `t${i}` } });
  const seen = [];
  let cursor;
  do {
    const { json } = await api(`/api/tasks?limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token });
    seen.push(...json.items.map((t) => t.id));
    cursor = json.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
});

test('search treats LIKE wildcards literally', async () => {
  const { accessToken: token } = await newUser();
  await api('/api/tasks', { method: 'POST', token, body: { title: '100% done' } });
  await api('/api/tasks', { method: 'POST', token, body: { title: 'other' } });
  const { json } = await api('/api/tasks?search=%25', { token });
  assert.equal(json.items.length, 1);
});

test('bulk update is atomic', async () => {
  const { accessToken: token } = await newUser();
  const { json: t } = await api('/api/tasks', { method: 'POST', token, body: { title: 'a' } });
  const r = await api('/api/tasks/bulk-status', { method: 'POST', token, body: { ids: [t.id, 999999], status: 'done' } });
  assert.equal(r.res.status, 404);
  const after = await api(`/api/tasks/${t.id}`, { token });
  assert.equal(after.json.status, 'todo'); // rolled back
});

test('CSV export streams and escapes quotes', async () => {
  const { accessToken: token } = await newUser();
  await api('/api/tasks', { method: 'POST', token, body: { title: 'say "hi"' } });
  const { res, text } = await api('/api/tasks/export.csv', { token });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(text, /"say ""hi"""/);
});

test('audit subscriber records events; unknown routes and bad JSON are handled', async () => {
  const { accessToken: token } = await newUser();
  await api('/api/tasks', { method: 'POST', token, body: { title: 'audited' } });
  await sleep(100); // the audit subscriber is fire-and-forget (async listener)
  const { rows } = await ctx.db.query("SELECT COUNT(*)::int AS c FROM audit_log WHERE event = 'task.created'");
  assert.ok(rows[0].c >= 1);
  assert.equal((await api('/nope')).res.status, 404);
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});
