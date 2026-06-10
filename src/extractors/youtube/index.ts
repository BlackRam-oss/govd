import { youtubeDl, Payload, Format, Protocol, Acodec } from 'youtube-dl-exec';
import { Extractor, MediaFormat, Media, ExtractorContext } from '../../models/index.js';
import { MediaType } from '../../database/index.js';
import { parseVideoCodec, parseAudioCodec } from '../../util/index.js';
import logger from '../../logger/index.js';

export const YouTubeExtractor = new Extractor({
  id: 'youtube',
  displayName: 'YouTube',
  urlPattern: /(?:https?:)?(?:\/\/)?(?:(?:www|m)\.)?(?:youtube(?:-nocookie)?\.com\/(?:(?:watch\?(?:.*&)?v=)|(?:embed\/)|(?:v\/)|(?:shorts\/))|youtu\.be\/)(?<id>[\w-]{11})(?:[?&].*)?/,
  host: ['youtube', 'youtu', 'youtube-nocookie'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  const url = `https://www.youtube.com/watch?v=${ctx.contentId}`;

  const options: Record<string, unknown> = {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
  };
  if (ctx.config.proxy) options['proxy'] = ctx.config.proxy;

  logger.debug({ videoId: ctx.contentId }, 'youtube: fetching via yt-dlp');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info = await youtubeDl(url, options as any) as Payload;

  const media = ctx.newMedia();
  media.setCaption(info.title ?? '');

  const item = media.newItem();
  let added = 0;

  for (const fmt of (info.formats ?? [])) {
    const mf = parseFormat(fmt);
    if (mf) { item.addFormats(mf); added++; }
  }

  if (!added) throw new Error('no usable formats found');

  return media;
}

function parseFormat(fmt: Format): MediaFormat | null {
  if (fmt.protocol !== Protocol.HTTPS) return null;
  if (!fmt.url) return null;

  const vNone = fmt.vcodec === 'none';
  const aNone = !fmt.acodec || fmt.acodec === Acodec.None;

  const isAudioOnly = vNone && !aNone;
  const isVideoOnly = !vNone && aNone;
  const isCombined = !vNone && !aNone;

  if (!isAudioOnly && !isVideoOnly && !isCombined) return null;

  const mf = new MediaFormat();
  mf.formatId = fmt.format_id;
  mf.url = [fmt.url];
  mf.bitrate = fmt.tbr != null ? Math.round(fmt.tbr * 1000) : 0;
  mf.fileSize = fmt.filesize ?? fmt.filesize_approx ?? 0;

  if (isAudioOnly) {
    mf.type = MediaType.Audio;
    mf.audioCodec = parseAudioCodec(fmt.acodec!);
    if (fmt.abr != null) mf.bitrate = Math.round(fmt.abr * 1000);
  } else {
    mf.type = MediaType.Video;
    mf.videoCodec = parseVideoCodec(fmt.vcodec);
    mf.width = fmt.width ?? 0;
    mf.height = fmt.height ?? 0;
    if (isCombined) mf.audioCodec = parseAudioCodec(fmt.acodec!);
  }

  if (!mf.videoCodec && !mf.audioCodec) return null;

  return mf;
}
