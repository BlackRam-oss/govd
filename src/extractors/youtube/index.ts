import { Innertube, Platform } from 'youtubei.js/cf-worker';
import { Extractor, MediaFormat, Media, ExtractorContext } from '../../models/index.js';
import { MediaType } from '../../database/index.js';
import { parseVideoCodec, parseAudioCodec, Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

// CF Workers lacks eval() — provide a Function-based evaluator for n-sig deciphering.
// The script is self-contained and ends with `return process(...)`.
(Platform.shim as any).eval = async (data: { output: string }) =>
  new Function(data.output)();

let innertube: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
  if (!innertube) {
    innertube = await Innertube.create({ retrieve_player: true });
  }
  return innertube;
}

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
  const yt = await getInnertube();
  logger.debug({ videoId: ctx.contentId }, 'youtube: fetching video info');

  const info = await yt.getInfo(ctx.contentId);

  if (
    info.playability_status?.status === 'AGE_CHECK_REQUIRED' ||
    info.playability_status?.reason?.includes('age')
  ) {
    throw Errors.AgeRestricted;
  }
  if (info.playability_status?.status !== 'OK') {
    const reason = info.playability_status?.reason ?? info.playability_status?.status;
    throw new Error(`not playable: ${reason}`);
  }

  const title = info.basic_info?.title ?? '';
  const duration = Math.round(info.basic_info?.duration ?? 0);

  // Muxed streams (video + audio in one file) — only viable option without ffmpeg.
  // Sorted best-first: height desc, then bitrate desc.
  const muxed = [...(info.streaming_data?.formats ?? [])].sort((a, b) => {
    const h = (b.height ?? 0) - (a.height ?? 0);
    return h !== 0 ? h : (b.average_bitrate ?? b.bitrate ?? 0) - (a.average_bitrate ?? a.bitrate ?? 0);
  });

  if (!muxed.length) throw Errors.Unavailable;

  const media = ctx.newMedia();
  media.setCaption(title);
  const item = media.newItem();
  let added = 0;

  for (const fmt of muxed) {
    const url = await fmt.decipher(yt.session.player);
    if (!url) continue;

    const videoCodec = parseVideoCodec(fmt.mime_type);
    const audioCodec = parseAudioCodec(fmt.mime_type);
    if (!videoCodec || !audioCodec) continue;

    const mf = new MediaFormat();
    mf.formatId = String(fmt.itag);
    mf.url = [url];
    mf.type = MediaType.Video;
    mf.videoCodec = videoCodec;
    mf.audioCodec = audioCodec;
    mf.width = fmt.width ?? 0;
    mf.height = fmt.height ?? 0;
    mf.bitrate = fmt.average_bitrate ?? fmt.bitrate ?? 0;
    mf.fileSize = fmt.content_length ?? 0;
    mf.duration = duration;
    item.addFormats(mf);
    added++;
  }

  if (!added) throw Errors.Unavailable;

  logger.debug({ videoId: ctx.contentId, formats: added }, 'youtube: resolved');
  return media;
}
