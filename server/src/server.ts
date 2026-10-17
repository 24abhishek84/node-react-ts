import { loadConfig } from './config';
import { createApp } from './app';
import { createLogger } from './logger';

async function main() {
  const logger = createLogger();
  const config = loadConfig();
  const { app, close } = await createApp(config, { logger });

  const server = app.listen(config.PORT, () => logger.info('listening', { port: config.PORT }));

  let shuttingDown = false;
  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    server.close(async () => {
      await close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: String(reason) });
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('uncaughtException', { err: message, stack });
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
