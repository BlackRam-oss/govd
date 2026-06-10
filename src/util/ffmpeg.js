import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Env } from '../config/index.js';
import logger from '../logger/index.js';

function tmpPath(ext) {
  return path.join(Env.DownloadsDir, `${uuidv4().replace(/-/g, '')}.${ext}`);
}

export function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export async function getVideoInfo(filePath) {
  try {
    const data = await probeFile(filePath);
    const video = data.streams.find(s => s.codec_type === 'video');
    const audio = data.streams.find(s => s.codec_type === 'audio');
    return {
      width: video?.width || 0,
      height: video?.height || 0,
      duration: Math.round(parseFloat(data.format.duration) || 0),
      videoCodec: video?.codec_name || '',
      audioCodec: audio?.codec_name || '',
      bitrate: parseInt(data.format.bit_rate) || 0,
    };
  } catch {
    return { width: 0, height: 0, duration: 0, videoCodec: '', audioCodec: '', bitrate: 0 };
  }
}

export function remuxToMP4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-c copy', '-movflags faststart'])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}

export function mergeAudioVideo(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(['-c copy', '-shortest'])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}

export function extractThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['5%'],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x?',
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

export async function getThumbnail(ctx, format, filePath) {
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
