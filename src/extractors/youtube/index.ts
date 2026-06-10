import { Extractor, MediaFormat, Media, ExtractorContext } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { parseVideoCodec, parseAudioCodec } from '../../util/index.js';
import logger from '../../logger/index.js';

const invEndpoint = '/api/v1/videos/';

export const YouTubeExtractor = new Extractor({
  id: 'youtube',
  displayName: 'YouTube',
  urlPattern: /(?:https?:)?(?:\/\/)?(?:(?:www|m)\.)?(?:youtube(?:-nocookie)?\.com\/(?:(?:watch\?(?:.*&)?v=)|(?:embed\/)|(?:v\/)|(?:shorts\/))|youtu\.be\/)(?<id>[\w-]{11})(?:[?&].*)?/,
  host: ['youtube', 'youtu', 'youtube-nocookie'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getVideoFromInv(ctx);
    return { media };
  },
});

async function getVideoFromInv(ctx: ExtractorContext): Promise<Media> {
  if (!ctx.config?.instance?.length) {
    throw new Error('youtube: no invidious instance configured');
  }
  let lastErr: unknown;
  for (let i = 0; i < ctx.config.instance.length; i++) {
    try {
      const instance = await getInvInstance(ctx, i);
      return await getFromInstance(ctx, instance);
    } catch (e) {
      lastErr = e;
      ctx.debug(`invidious instance failed: ${(e as Error).message}`);
    }
  }
  throw lastErr || new Error('all invidious instances failed');
}

async function getInvInstance(ctx: ExtractorContext, index: number): Promise<string> {
  return ctx.config.instance[index];
}

async function getFromInstance(ctx: ExtractorContext, instance: string): Promise<Media> {
  const videoId = ctx.contentId;
  const url = `${instance}${invEndpoint}${videoId}?local=true`;

  ctx.debug(`invidious api: ${url}`);

  const resp = await ctx.fetch('GET', url);
  if (resp.status !== 200) throw new Error(`bad response: ${resp.status}`);

  const data = resp.data as InvidiousVideoData;
  if (data.error === 'This video may be inappropriate for some users.') {
    const { Errors } = await import('../../util/index.js');
    throw Errors.AgeRestricted;
  }

  const formats = parseInvFormats(data, instance);
  if (!formats.length) throw new Error('no formats found');

  const media = ctx.newMedia();
  const item = media.newItem();
  item.addFormats(...formats);
  return media;
}

interface InvidiousAdaptiveFormat {
  url?: string;
  itag?: number | string;
  bitrate?: number;
  clen?: string;
  type?: string;
  encoding?: string;
  width?: number;
  height?: number;
}

interface InvidiousFormatStream {
  url?: string;
  itag?: number | string;
  bitrate?: number;
  encoding?: string;
  size?: string;
}

interface InvidiousVideoData {
  error?: string;
  adaptiveFormats?: InvidiousAdaptiveFormat[];
  formatStreams?: InvidiousFormatStream[];
}

function parseInvFormats(data: InvidiousVideoData, instance: string): MediaFormat[] {
  const formats: MediaFormat[] = [];

  for (const fmt of (data.adaptiveFormats || [])) {
    if (!fmt.url) continue;
    const mf = new MediaFormat();
    mf.formatId = fmt.itag?.toString() || '';
    mf.url = [fmt.url.startsWith('http') ? fmt.url : instance + fmt.url];
    mf.bitrate = fmt.bitrate || 0;
    mf.fileSize = fmt.clen ? parseInt(fmt.clen) : 0;

    if (fmt.type?.includes('video')) {
      mf.type = MediaType.Video;
      mf.videoCodec = parseVideoCodec(fmt.encoding || fmt.type || '');
      mf.width = fmt.width || 0;
      mf.height = fmt.height || 0;
    } else if (fmt.type?.includes('audio')) {
      mf.type = MediaType.Audio;
      mf.audioCodec = parseAudioCodec(fmt.encoding || fmt.type || '');
    }

    if (mf.videoCodec || mf.audioCodec) formats.push(mf);
  }

  for (const fmt of (data.formatStreams || [])) {
    if (!fmt.url) continue;
    const mf = new MediaFormat();
    mf.formatId = fmt.itag?.toString() || 'combined';
    mf.url = [fmt.url];
    mf.type = MediaType.Video;
    mf.videoCodec = parseVideoCodec(fmt.encoding || '');
    mf.audioCodec = MediaCodec.Aac;
    mf.width = fmt.size ? parseInt(fmt.size.split('x')[0]) : 0;
    mf.height = fmt.size ? parseInt(fmt.size.split('x')[1]) : 0;
    mf.bitrate = fmt.bitrate || 0;
    formats.push(mf);
  }

  return formats;
}
