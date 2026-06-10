import sharp from 'sharp';
import fs from 'fs';
import logger from '../logger/index.js';

export async function bufferToJpeg(buffer: Buffer, outputPath: string, quality: number = 85): Promise<{ w: number; h: number }> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  await image
    .jpeg({ quality: quality || 85 })
    .toFile(outputPath);
  return { w: meta.width || 0, h: meta.height || 0 };
}
