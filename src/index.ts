/// <reference types="@cloudflare/workers-types" />

import { webhookCallback } from 'grammy';
import { Env } from './config/index.js';
import { init as initDB } from './database/index.js';
import logger from './logger/index.js';
import { createBot, registerHandlers } from './bot/index.js';

export interface WorkerEnv {
  BOT_TOKEN?: string;
  BOT_KV?: KVNamespace;
  DB?: D1Database;
  BOT_USERNAME?: string;
  OWNER_ID?: string;
}

// Module-level init (runs once on Worker cold start)
if (Env.Admins.length > 0) {
  logger.info({ admins: Env.Admins }, 'admins configured');
}

if (Env.Whitelist.length > 0) {
  const combined = [...new Set([...Env.Whitelist, ...Env.Admins])];
  Env.Whitelist.splice(0, Env.Whitelist.length, ...combined);
  logger.info({ whitelist: Env.Whitelist }, 'whitelist enabled');
}

initDB();

const bot = createBot();
registerHandlers(bot);

const handleUpdate = webhookCallback(bot, 'cloudflare-mod');

export default {
  async fetch(request: Request, _env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    return handleUpdate(request);
  },
};
