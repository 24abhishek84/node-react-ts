import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
}

interface CreateLoggerOptions {
  silent?: boolean;
}

export function createLogger({ silent = false }: CreateLoggerOptions = {}): Logger {
  const write = (level: 'info' | 'error' | 'warn', msg: string, extra?: Record<string, unknown>) => {
    if (silent) return;
    const line = {
      level,
      time: new Date().toISOString(),
      requestId: requestContext.getStore()?.requestId,
      msg,
      ...extra,
    };
    (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(line) + '\n');
  };

  return {
    info: (msg, extra) => write('info', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
  };
}
