import { instagramGetUrl } from 'instagram-url-direct';
import { Extractor, MediaFormat, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

const instagramHost: string[] = ['instagram', 'ddinstagram'];

export const InstagramExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/(reels?|p|tv)\/(?<id>[a-zA-Z0-9_-]+)/,
  host: instagramHost,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media };
  },
});

export const InstagramStoriesExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram Stories',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/stories\/[a-zA-Z0-9._]+\/(?<id>\d+)/,
  host: instagramHost,
  hidden: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media };
  },
});

export const InstagramShareExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram (Share)',
  urlPattern: /https?:\/\/(www\.)?(?:dd)?instagram\.com\/share\/((reels?|video|s|p)\/)?(?<id>[^\/\?]+)/,
  host: instagramHost,
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const url = await ctx.fetchLocation(ctx.contentUrl);
    return { url };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  logger.debug({ url: ctx.contentUrl }, 'instagram: fetching via instagram-url-direct');

  let response: Awaited<ReturnType<typeof instagramGetUrl>>;
  try {
    response = await instagramGetUrl(ctx.contentUrl, { retries: 3, delay: 500 });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'instagram: instagramGetUrl failed');
    throw new Error(`instagram-url-direct failed: ${(e as Error).message}`);
  }

  if ('error' in response) {
    throw new Error(`instagram error: ${response.error}`);
  }

  if (!response.media_details?.length) throw Errors.Unavailable;

  const media = ctx.newMedia();
  media.setCaption(response.post_info?.caption ?? '');

  for (const detail of response.media_details) {
    const item = media.newItem();
    const mf = new MediaFormat();
    mf.url = [detail.url];
    mf.width = detail.dimensions?.width ?? 0;
    mf.height = detail.dimensions?.height ?? 0;

    if (detail.type === 'video') {
      mf.type = MediaType.Video;
      mf.formatId = 'video';
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      if (detail.thumbnail) mf.thumbnailUrl = [detail.thumbnail];
    } else {
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
    }
    item.addFormats(mf);
  }

  return media;
}
