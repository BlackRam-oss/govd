import { Extractor, Media, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { unescapeURL, parseVideoCodec, parseAudioCodec } from '../../util/index.js';
import logger from '../../logger/index.js';
import { ExtractorContext } from '../../models/index.js';

const baseHost = ['reddit', 'redditmedia'];

export const RedditShortExtractor = new Extractor({
  id: 'reddit',
  displayName: 'Reddit (Short)',
  urlPattern: /https?:\/\/(?<host>(?:\w+\.)?reddit(?:media)?\.com)\/(?<slug>(?:(?:r|user)\/[^/]+\/)?s\/(?<id>[^/?#&]+))/,
  host: baseHost,
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const resp = await ctx.fetch('GET', ctx.contentUrl);
    const location = resp.request?.res?.responseUrl || resp.config?.url || ctx.contentUrl;
    return { url: location };
  },
});

export const RedditExtractor = new Extractor({
  id: 'reddit',
  displayName: 'Reddit',
  urlPattern: /https?:\/\/(?<host>(?:\w+\.)?reddit(?:media)?\.com)\/(?<slug>(?:(?:r|user)\/[^/]+\/)?comments\/(?<id>[^/?#&]+))/,
  host: baseHost,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await mediaFromAPI(ctx);
    return { media: media ?? undefined };
  },
});

async function mediaFromAPI(ctx: ExtractorContext): Promise<Media | null> {
  const host = ctx.matchGroups?.host || 'www.reddit.com';
  const slug = ctx.matchGroups?.slug || ctx.contentId;

  const manifest = await getRedditData(ctx, host, slug, false) as any[];
  if (!manifest?.length || !manifest[0]?.data?.children?.length) {
    throw new Error('no data found in reddit response');
  }

  const data = manifest[0].data.children[0].data;
  const title: string = data.title;
  const isNsfw: boolean = data.over_18;

  const media = ctx.newMedia();
  if (isNsfw) media.setNSFW();
  media.setCaption(title);

  if (!data.is_video) {
    if (data.preview?.images?.length) {
      const item = media.newItem();
      const image = data.preview.images[0];

      if (data.preview.reddit_video_preview) {
        const formats = await getHLSFormats(ctx, data.preview.reddit_video_preview.fallback_url, data.preview.reddit_video_preview.duration);
        item.addFormats(...formats);
        return media;
      }

      if (image.variants?.mp4) {
        const mf = new MediaFormat();
        mf.formatId = 'gif';
        mf.type = MediaType.Video;
        mf.videoCodec = MediaCodec.Avc;
        mf.audioCodec = MediaCodec.Aac;
        mf.url = [unescapeURL(image.variants.mp4.source.url)];
        item.addFormats(mf);
        return media;
      }

      const mf = new MediaFormat();
      mf.formatId = 'photo';
      mf.type = MediaType.Photo;
      mf.url = [unescapeURL(image.source.url)];
      item.addFormats(mf);
      return media;
    }

    if (data.media_metadata && Object.keys(data.media_metadata).length) {
      for (const [, obj] of Object.entries(data.media_metadata)) {
        const item = media.newItem();
        if ((obj as any).e === 'Image') {
          const mf = new MediaFormat();
          mf.formatId = 'photo';
          mf.type = MediaType.Photo;
          mf.url = [unescapeURL((obj as any).s?.u || '')];
          item.addFormats(mf);
        } else if ((obj as any).e === 'AnimatedImage') {
          const mf = new MediaFormat();
          mf.formatId = 'video';
          mf.type = MediaType.Video;
          mf.videoCodec = MediaCodec.Avc;
          mf.audioCodec = MediaCodec.Aac;
          mf.url = [unescapeURL((obj as any).s?.mp4 || '')];
          item.addFormats(mf);
        }
      }
      return media;
    }
  } else {
    const item = media.newItem();
    const redditVideo =
      data.media?.reddit_video || data.secure_media?.reddit_video;
    if (redditVideo) {
      const formats = await getHLSFormats(ctx, redditVideo.fallback_url, redditVideo.duration);
      item.addFormats(...formats);
      return media;
    }
  }

  return null;
}

async function getRedditData(ctx: ExtractorContext, host: string, slug: string, raise: boolean): Promise<unknown> {
  const url = `https://${host}/${slug}/.json`;
  const resp = await ctx.fetch('GET', url);

  if (resp.status !== 200) {
    if (raise) throw new Error(`failed to get reddit data: ${resp.status}`);
    const altHost = host === 'old.reddit.com' ? 'www.reddit.com' : 'old.reddit.com';
    return getRedditData(ctx, altHost, slug, true);
  }

  return resp.data;
}

async function getHLSFormats(ctx: ExtractorContext, fallbackUrl: string, duration: number): Promise<MediaFormat[]> {
  if (!fallbackUrl) return [];

  const hlsUrl = fallbackUrl.replace(/\/DASH_\d+/, '/HLS_AUDIO').replace(/[?#].*$/, '');
  const audioUrl = fallbackUrl.replace(/\/DASH_\d+.*/, '/DASH_audio.mp4');

  const mf = new MediaFormat();
  mf.formatId = 'video';
  mf.type = MediaType.Video;
  mf.videoCodec = MediaCodec.Avc;
  mf.audioCodec = MediaCodec.Aac;
  mf.url = [fallbackUrl];
  mf.duration = duration || 0;

  return [mf];
}
