import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Env } from '../config/index.js';
import logger from '../logger/index.js';
import type { ExtractorContext, DownloadSettings } from '../models/index.js';

export function toPath(fileName: string): string {
  return path.join(Env.DownloadsDir, fileName);
}

export async function downloadFile(
  ctx: ExtractorContext,
  urls: string[],
  fileName: string,
  downloadSettings: DownloadSettings | null = null,
): Promise<string> {
  fs.mkdirSync(Env.DownloadsDir, { recursive: true });

  const filePath = toPath(fileName);
  const client = ctx.httpClient.asDownloadClient();

  const headers = { ...(downloadSettings?.headers || {}) };
  const cookies = downloadSettings?.cookies || undefined;

  let lastError: Error | undefined;
  for (const url of urls) {
    try {
      const response = await client.fetch('GET', url, {
        headers,
        cookies,
        responseType: 'stream',
      });

      if (response.status < 200 || response.status >= 300) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      const writer = fs.createWriteStream(filePath);
      await new Promise<void>((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });

      ctx.filesTracker.add(filePath);
      logger.debug({ filePath }, 'downloaded file');
      return filePath;
    } catch (e) {
      lastError = e as Error;
    }
  }

  throw lastError || new Error('download failed');
}

export async function downloadFileInMemory(
  ctx: ExtractorContext,
  urls: string[],
  downloadSettings: DownloadSettings | null = null,
): Promise<Buffer> {
  const client = ctx.httpClient.asDownloadClient();
  const headers = { ...(downloadSettings?.headers || {}) };
  const cookies = downloadSettings?.cookies || undefined;

  let lastError: Error | undefined;
  for (const url of urls) {
    try {
      const response = await client.fetch('GET', url, {
        headers,
        cookies,
        responseType: 'arraybuffer',
      });
      if (response.status < 200 || response.status >= 300) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return Buffer.from(response.data);
    } catch (e) {
      lastError = e as Error;
    }
  }

  throw lastError || new Error('download failed');
}

export async function downloadFileWithSegments(
  ctx: ExtractorContext,
  initSegment: string | null,
  segments: string[],
  fileName: string,
  downloadSettings: DownloadSettings | null = null,
): Promise<string> {
  fs.mkdirSync(Env.DownloadsDir, { recursive: true });

  const filePath = toPath(fileName);
  const client = ctx.httpClient.asDownloadClient();
  const headers = { ...(downloadSettings?.headers || {}) };

  const chunks: Buffer[] = [];

  if (initSegment) {
    const resp = await client.fetch('GET', initSegment, { headers, responseType: 'arraybuffer' });
    chunks.push(Buffer.from(resp.data));
  }

  const CONCURRENCY = 5;
  for (let i = 0; i < segments.length; i += CONCURRENCY) {
    const batch = segments.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(seg => client.fetch('GET', seg, { headers, responseType: 'arraybuffer' }))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        chunks.push(Buffer.from(r.value.data));
      } else {
        throw r.reason;
      }
    }
  }

  fs.writeFileSync(filePath, Buffer.concat(chunks));
  ctx.filesTracker.add(filePath);
  return filePath;
}
