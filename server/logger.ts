// OBS-01: Structured JSON logging via pino
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

// Create child loggers for each component
export const agentLogger = logger.child({ component: 'agent' });
export const memoryLogger = logger.child({ component: 'memory' });
export const monitorLogger = logger.child({ component: 'monitor' });
export const jobLogger = logger.child({ component: 'jobs' });
