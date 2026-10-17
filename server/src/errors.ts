export class AppError extends Error {
  name = 'AppError';

  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

export const unauthorized = (msg = 'Unauthorized') =>
  new AppError(401, 'UNAUTHORIZED', msg);

export const notFound = (what = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (msg: string, code = 'CONFLICT') =>
  new AppError(409, code, msg);

export const tooMany = () =>
  new AppError(429, 'RATE_LIMITED', 'Too many requests');
