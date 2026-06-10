import pino from 'pino';
import { Env } from '../config/index.js';

const levelMap = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const level = levelMap[Env.LogLevel] || 'info';

export const logger = pino({
  level,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

export default logger;
