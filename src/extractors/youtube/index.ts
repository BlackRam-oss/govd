import { Innertube } from 'youtubei.js/cf-worker';
import { Extractor, MediaFormat, Media, ExtractorContext } from '../../models/index.js';
import { MediaType } from '../../database/index.js';
import { parseVideoCodec, parseAudioCodec } from '../../util/index.js';
import logger from '../../logger/index.js';

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
  logger.debug({ videoId: ctx.contentId }, 'youtube: fetching via youtubei.js');

  const info = await yt.getBasicInfo(ctx.contentId);

  if (info.playability_status?.status === 'AGE_CHECK_REQUIRED' ||
      info.playability_status?.reason?.includes('age')) {
    const { Errors } = await import('../../util/index.js');
    throw Errors.AgeRestricted;
  }
  if (info.playability_status?.status !== 'OK') {
    throw new Error(`not playable: ${info.playability_status?.reason ?? info.playability_status?.status}`);
  }

  const title = info.basic_info?.title ?? '';
  const allFormats = [
    ...(info.streaming_data?.adaptive_formats ?? []),
    ...(info.streaming_data?.formats ?? []),
  ];

  const media = ctx.newMedia();
  media.setCaption(title);
  const item = media.newItem();
  let added = 0;

  for (const fmt of allFormats) {
    const url = await fmt.decipher(yt.session.player);
    if (!url) continue;

    const mf = new MediaFormat();
    mf.formatId = String(fmt.itag);
    mf.url = [url];
    mf.bitrate = fmt.average_bitrate ?? fmt.bitrate ?? 0;
    mf.fileSize = fmt.content_length ?? 0;
    mf.duration = Math.round((fmt.approx_duration_ms ?? 0) / 1000);

    if (fmt.has_video) {
      mf.type = MediaType.Video;
      mf.videoCodec = parseVideoCodec(fmt.mime_type);
      mf.width = fmt.width ?? 0;
      mf.height = fmt.height ?? 0;
    } else {
      mf.type = MediaType.Audio;
    }
    if (fmt.has_audio) {
      mf.audioCodec = parseAudioCodec(fmt.mime_type);
    }

    if (mf.videoCodec || mf.audioCodec) {
      item.addFormats(mf);
      added++;
    }
  }

  if (!added) throw new Error('no usable formats found');
  return media;
}
