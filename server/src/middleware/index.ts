import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { requestContext } from '../logger';
import { AppError, unauthorized, tooMany, notFound, badRequest } from '../errors';
import type { Logger } from '../logger';
import { z } from 'zod';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number };
      valid?: Record<string, any>;
    }
  }
}

export function requestId(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.get('x-request-id') ?? randomUUID();
    res.set('x-request-id', id);
    const start = process.hrtime.bigint();
    requestContext.run({ requestId: id }, () => {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info('request', {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms: +ms.toFixed(1),
        });
      });
      next();
    });
  };
}

export function cors(origin: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.set({
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type, authorization, if-match',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'etag, x-request-id',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

interface RateLimitOptions {
  limit: number;
  windowMs?: number;
}

export function rateLimit({ limit, windowMs = 60_000 }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, number>();
  const timer = setInterval(() => hits.clear(), windowMs);
  timer.unref();
  return (req: Request, _res: Response, next: NextFunction) => {
    const count = (hits.get(req.ip ?? '') ?? 0) + 1;
    hits.set(req.ip ?? '', count);
    next(count > limit ? tooMany() : undefined);
  };
}

export function requireAuth(secret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing bearer token'));
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub: string };
      req.user = { id: Number(payload.sub) };
      next();
    } catch {
      next(unauthorized('Invalid or expired token'));
    }
  };
}

interface ValidateOptions {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
}

export function validate({ body, query, params }: ValidateOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const valid: Record<string, any> = {};
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = (schema as z.ZodSchema).safeParse(req[key as keyof Request]);
      if (!result.success) {
        const details = result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        return next(badRequest('Validation failed', details));
      }
      valid[key] = (result as any).data;
    }
    req.valid = valid;
    next();
  };
}

export const notFoundHandler: RequestHandler = (req: Request, _res: Response, next: NextFunction) =>
  next(notFound(`Route ${req.method} ${req.path}`));

export function errorHandler(logger: Logger) {
  return (
    err: Error & { type?: string; status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({
          error: { code: err.code, message: err.message, details: err.details },
        });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('unhandled error', { err: message, stack });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
}
