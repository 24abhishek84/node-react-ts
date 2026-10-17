# TaskFlow – Node.js refresher project (TypeScript, Node 22+/23, Express 5, React 19)

Small but production-shaped. Read it in the order below, then do the exercises.

## Run
```
docker compose up -d           # Postgres 17 on localhost:5433 (db/user/password: taskflow)
cd server && npm install       # Install dependencies
cd server && npm run build     # Compile TypeScript
cd server && npm test          # 10 integration tests (node:test) in a throwaway schema
cd server && npm run dev       # Rebuild on file changes, API on :3000
cd client && npm install       # Install dependencies
cd client && npm run dev       # UI on :5173, proxies /api
```
**DBeaver:** New connection > PostgreSQL > host `localhost`, port `5433`, database/user/password `taskflow`. Watch `tasks`, `refresh_tokens` and `audit_log` change while you use the UI. Override with `DATABASE_URL`.

## Reading order (and what each file teaches)
| File | Topics to be able to explain |
|---|---|
| `server/src/config.ts` | env validation with zod, fail fast, frozen config, TypeScript types from zod schemas |
| `server/src/server.ts` | graceful shutdown, SIGTERM, `unhandledRejection` policy, `unref()`, async main with error handling |
| `server/src/app.ts` | composition root / dependency injection, testability, TypeScript interfaces |
| `server/src/middleware/index.ts` | AsyncLocalStorage request ids, middleware order, error handler (4 args), rate limiting, Express 5 `req.query` read-only, Express Request/Response typing |
| `server/src/errors.ts` | operational vs programmer errors, custom error classes with TypeScript |
| `server/src/db.ts` | `pg` Pool, checking out a client for transactions, migrations with advisory lock, type parsers (int8/date), `release()` in `finally`, generic query typing |
| `modules/auth/*` | bcrypt, JWT access + rotating opaque refresh tokens, reuse detection, timing-safe login, service/route separation |
| `modules/tasks/*` | keyset pagination, optimistic locking (ETag/If-Match, 409), SQL injection safety (prepared statements, dynamic SQL built only from whitelists), LIKE escaping, streams + backpressure, generators, atomic bulk ops, authz by scoping queries |
| `server/src/events.ts` | EventEmitter decoupling and its pitfalls, event payload typing |
| `server/test/api.test.js` | integration testing against a real server on an ephemeral port |
| `client/src/api.ts` | single-flight token refresh, retry-once on 401, TypeScript generics, custom API error handling |
| `client/src/App.tsx` | stale-response guard, debounce, optimistic update + rollback, stable callbacks / effect deps, React TypeScript patterns |

## Debugging exercises (do each one, then run the tests)
Start with `node --inspect-brk dist/server.js` (or VS Code "JavaScript Debug Terminal") and step through.
1. **Break the ownership check.** Remove `AND user_id = ?` from `get()`. Which test fails? Why is this a critical bug (IDOR)?
2. **Remove `await`** from `bcrypt.compare` in `login`. What happens to tests and why? (Truthy Promise.)
3. **Swap middleware order**: put `express.json()` after the routes. What do requests see in `req.body`?
4. **Break the atomic claim in `refresh()`.** Replace the single `UPDATE ... WHERE revoked = false RETURNING` with a `SELECT` followed by an `UPDATE`, then fire 2 parallel refresh requests with the same token. Both succeed (race). Why does the single statement prevent it?
5. **Add `async` + `await` to a sync handler but forget the error path in Express 4 style (`try/catch` + `next`)**: confirm Express 5 does this for you; then reason about what Express 4 would do (hung request).
6. **Change keyset pagination to `OFFSET`** and insert rows between page fetches; show duplicates/skips.
7. **Remove `.unref()`** in `rateLimit`; observe tests hanging at exit (use `process.getActiveResourcesInfo()`).
8. **Event-loop block:** add `bcrypt.hashSync` in `register`, run `autocannon`/many parallel curls against `/health` meanwhile; measure latency.
9. **Memory:** change `/export.csv` to build a big array and `res.send` it; compare RSS with 200k rows (`process.memoryUsage()`).
10. **Client:** remove `useCallback` from `logout` in `App.tsx`; watch the network tab loop. Then remove the `requestSeq` guard and type fast in search.

## Extension tasks (to build experience)
- Move CPU work (e.g., CSV export with 1M rows or password hashing) to `worker_threads`.
- Replace in-memory rate limiter with a Redis-backed one; add Redis cache for `/stats` with invalidation on events.
- Add a `/api/tasks/events` Server-Sent Events endpoint fed by the event bus.
- Add pino + OpenTelemetry; add Docker + health/readiness probes.
- Add a `GET /api/tasks/:id/history` using the `audit_log` JSONB column (`payload->>'taskId'`) plus a GIN index; compare with `EXPLAIN ANALYZE` in DBeaver.
- Reproduce a lost update and a deadlock with two DBeaver sessions; fix with `SELECT ... FOR UPDATE` / consistent lock ordering.
- Add React Testing Library + Vitest tests for `api.js` single-flight refresh.

## Interview questions this project lets you answer with code
- Explain the event loop phases; `process.nextTick` vs `setImmediate` vs microtasks. What blocks it here, what doesn't?
- `Promise.all` vs `allSettled` vs `race`; unhandled rejections in Node 15+ (crash by default).
- Streams: why `pipeline` over `.pipe`? What is backpressure? (`/export.csv`)
- Cluster vs worker_threads vs horizontal scaling; why in-memory rate limits/sessions break with multiple instances.
- JWT vs sessions; where to store tokens (localStorage is XSS-exposed; httpOnly cookie + CSRF is the alternative); refresh rotation.
- Idempotency, optimistic vs pessimistic locking, transactions, N+1, indexing (`idx_tasks_user_status`).
- ESM vs CommonJS (`"type": "module"`, no `__dirname`, top-level await, `import.meta`).
- Testing strategy: unit vs integration; why DI makes tests easy.
- Security checklist: validation, prepared statements, rate limiting, body size limit, CORS, no stack traces to clients, secrets from env, `x-powered-by` off; what's still missing (helmet headers, CSRF if cookies, account lockout, HTTPS).
- What changed since ~2020: built-in `fetch`, `node:test`, `--watch`, `--env-file`, `node:sqlite`, permission model, stable ESM, `AbortSignal.timeout`, Express 5 async error handling, `structuredClone`, `Array.prototype.at/findLast/toSorted`.

## Known limitations (deliberate, for discussion)
in-memory rate limiter; tokens in localStorage; audit events are fire-and-forget (can be lost on crash; an outbox table fixes that); no CSRF/helmet; raw SQL with no query builder/ORM (discuss trade-offs vs Prisma/Drizzle/Knex).
