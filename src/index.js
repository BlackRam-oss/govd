import fs from 'fs';
import { Env } from './config/index.js';
import { init as initDB } from './database/index.js';
import logger from './logger/index.js';
import { checkFFmpeg, cleanupDownloadsJob } from './util/index.js';
import { startBot } from './bot/index.js';

async function main() {
  logger.info('starting govd...');

  // create downloads directory
  fs.mkdirSync(Env.DownloadsDir, { recursive: true });

  if (!checkFFmpeg()) {
    logger.fatal('ffmpeg binary not found in PATH');
    process.exit(1);
  }

  if (Env.Admins.length > 0) {
    logger.info({ admins: Env.Admins }, 'admins configured');
  }

  if (Env.Whitelist.length > 0) {
    const combined = [...new Set([...Env.Whitelist, ...Env.Admins])];
    Env.Whitelist.splice(0, Env.Whitelist.length, ...combined);
    logger.info({ whitelist: Env.Whitelist }, 'whitelist enabled');
  }

  initDB();

  cleanupDownloadsJob();

  await startBot();
}

main().catch(err => {
  logger.fatal({ err: err.message }, 'fatal error');
  process.exit(1);
});
