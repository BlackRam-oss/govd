import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Env } from '../config/index.js';
import type { ExtractorContext, MediaFormat } from '../models/index.js';

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  videoCodec: string;
  audioCodec: string;
  bitrate: number;
}

function tmpPath(ext: string): string {
  return path.join(Env.DownloadsDir, `${uuidv4().replace(/-/g, '')}.${ext}`);
}

// fluent-ffmpeg is imported dynamically so Workers don't crash at module load
// (fluent-ffmpeg internally requires child_process, not available in Workers)

export async function probeFile(filePath: string): Promise<unknown> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    (ffmpeg as any).ffprobe(filePath, (err: Error | null, data: unknown) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  try {
    const data = await probeFile(filePath) as any;
    const video = data.streams?.find((s: any) => s.codec_type === 'video');
    const audio = data.streams?.find((s: any) => s.codec_type === 'audio');
    return {
      width: video?.width || 0,
      height: video?.height || 0,
      duration: Math.round(parseFloat(String(data.format?.duration ?? '0')) || 0),
      videoCodec: video?.codec_name || '',
      audioCodec: audio?.codec_name || '',
      bitrate: parseInt(String(data.format?.bit_rate ?? '0')) || 0,
    };
  } catch {
    return { width: 0, height: 0, duration: 0, videoCodec: '', audioCodec: '', bitrate: 0 };
  }
}

export async function remuxToMP4(inputPath: string, outputPath: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    (ffmpeg as any)(inputPath)
      .outputOptions(['-c copy', '-movflags faststart'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', reject);
  });
}

export async function mergeAudioVideo(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    (ffmpeg as any)()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(['-c copy', '-shortest'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', reject);
  });
}

export async function extractThumbnail(videoPath: string, outputPath: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    (ffmpeg as any)(videoPath)
      .screenshots({
        timestamps: ['5%'],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x?',
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
}

export async function getThumbnail(ctx: ExtractorContext, format: MediaFormat, filePath: string): Promise<string> {
  if (format.thumbnailUrl?.length) {
    const fileName = uuidv4().replace(/-/g, '') + '.jpg';
    try {
      const { downloadFile } = await import('./download.js');
      const thumbPath = await downloadFile(ctx, format.thumbnailUrl, fileName);
      return thumbPath;
    } catch {}
  }

  if (format.type !== 'video') return '';

  try {
    const thumbPath = tmpPath('jpg');
    ctx.filesTracker.add(thumbPath);
    fs.mkdirSync(Env.DownloadsDir, { recursive: true });
    await extractThumbnail(filePath, thumbPath);
    return thumbPath;
  } catch {
    return '';
  }
}
