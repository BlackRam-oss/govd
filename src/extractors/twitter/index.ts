import { TwitterApi } from 'twitter-api-v2';
import type { MediaObjectV2 } from 'twitter-api-v2';
import { Extractor, MediaFormat, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';
import { Env } from '../../config/index.js';

let twitterClient: TwitterApi | null = null;

function getTwitterClient(): TwitterApi {
  if (!twitterClient) {
    const token = Env.TwitterBearerToken;
    if (!token) throw Errors.AuthenticationNeeded;
    twitterClient = new TwitterApi(token);
  }
  return twitterClient;
}

export const TwitterShortExtractor = new Extractor({
  id: 'twitter',
  displayName: 'Twitter (Short)',
  urlPattern: /https?:\/\/t\.co\/(?<id>\w+)/,
  host: ['t'],
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const url = await ctx.fetchLocation(ctx.contentUrl);
    return { url };
  },
});

export const TwitterExtractor = new Extractor({
  id: 'twitter',
  displayName: 'Twitter (X)',
  urlPattern: /https?:\/\/(?:fx|vx|fixup)?(twitter|x)\.com\/([^\/]+)\/status\/(?<id>\d+)/,
  host: ['x', 'twitter', 'fxtwitter', 'vxtwitter', 'fixuptwitter', 'fixupx'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media: media ?? undefined };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media | null> {
  const client = getTwitterClient();
  logger.debug({ tweetId: ctx.contentId }, 'twitter: fetching via twitter-api-v2');

  const result = await client.v2.singleTweet(ctx.contentId, {
    expansions: ['attachments.media_keys'],
    'media.fields': ['url', 'variants', 'width', 'height', 'type', 'preview_image_url'],
    'tweet.fields': ['text'],
  });

  if (!result.data) throw Errors.Unavailable;

  const mediaItems: MediaObjectV2[] = result.includes?.media ?? [];
  if (!mediaItems.length) return null;

  const caption = sanitizeCaption(result.data.text ?? '');
  const media = ctx.newMedia();
  media.setCaption(caption);

  for (const entity of mediaItems) {
    const item = media.newItem();

    if (entity.type === 'photo') {
      if (!entity.url) continue;
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
      mf.url = [entity.url + '?format=jpg&name=large'];
      mf.width = entity.width ?? 0;
      mf.height = entity.height ?? 0;
      item.addFormats(mf);
    } else if (entity.type === 'video' || entity.type === 'animated_gif') {
      const variants = (entity.variants ?? [])
        .filter(v => v.content_type === 'video/mp4' && v.url);

      for (const v of variants) {
        const mf = new MediaFormat();
        mf.type = MediaType.Video;
        mf.formatId = v.bit_rate?.toString() ?? 'video';
        mf.url = [v.url];
        mf.videoCodec = MediaCodec.Avc;
        mf.audioCodec = MediaCodec.Aac;
        mf.bitrate = v.bit_rate ?? 0;
        mf.width = entity.width ?? 0;
        mf.height = entity.height ?? 0;
        if (entity.preview_image_url) mf.thumbnailUrl = [entity.preview_image_url];
        item.addFormats(mf);
      }
    }
  }

  return media.items.length ? media : null;
}

function sanitizeCaption(text: string): string {
  return text.replace(/https?:\/\/t\.co\/\S+/g, '').trim();
}
