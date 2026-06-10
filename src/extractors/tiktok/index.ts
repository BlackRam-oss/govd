import { getVideoMeta } from 'tiktok-scraper';
import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

export const TikTokVMExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok VM',
  urlPattern: /https:\/\/((?:vm|vt|www)\.)?(?:vx)?tiktok\.com\/(?:t\/)?(?<id>[a-zA-Z0-9-]+)/,
  host: ['tiktok', 'vxtiktok'],
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const redirectUrl = await ctx.fetchLocation(ctx.contentUrl);

    let url: string;
    try {
      const parsed = new URL(redirectUrl);
      if (parsed.pathname === '/login') {
        const realURL = parsed.searchParams.get('redirect_url');
        if (!realURL) throw Errors.GeoRestricted;
        url = realURL;
      } else {
        url = redirectUrl;
      }
    } catch (e) {
      if ((e as { id?: string }).id) throw e;
      throw new Error(`failed to parse redirect url: ${(e as Error).message}`);
    }

    return { url };
  },
});

export const TikTokExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok',
  urlPattern: /https?:\/\/((www|m)\.)?(vx)?tiktok\.com\/((?:embed|@[\w\.-]*)\/)?(v(ideo)?|p(hoto)?)\/(?<id>[0-9]+)/,
  host: ['tiktok', 'vxtiktok'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { url: ctx.contentUrl, media };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  logger.debug({ videoId: ctx.contentId }, 'tiktok: fetching via tiktok-scraper');

  let result: Awaited<ReturnType<typeof getVideoMeta>>;
  try {
    result = await getVideoMeta(ctx.contentUrl, { noWaterMark: true });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'tiktok: getVideoMeta failed');
    throw new Error(`tiktok-scraper failed: ${(e as Error).message}`);
  }

  const post = result.collector?.[0];
  if (!post) throw Errors.Unavailable;

  const videoUrl = post.videoUrlNoWaterMark || post.videoUrl;
  if (!videoUrl) throw Errors.Unavailable;

  const media = ctx.newMedia();
  media.setCaption(post.text ?? '');

  const item = media.newItem();
  const mf = new MediaFormat();
  mf.type = MediaType.Video;
  mf.formatId = 'video';
  mf.url = [videoUrl];
  mf.videoCodec = MediaCodec.Avc;
  mf.audioCodec = MediaCodec.Aac;
  mf.width = post.videoMeta?.width ?? 0;
  mf.height = post.videoMeta?.height ?? 0;
  mf.duration = post.videoMeta?.duration ?? 0;
  mf.downloadSettings = new DownloadSettings({
    headers: { Referer: 'https://www.tiktok.com/' },
  });
  item.addFormats(mf);

  return media;
}
