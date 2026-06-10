import { Extractor, MediaFormat, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';
import type { Cookie } from '../../networking/index.js';

const apiBase = 'https://x.com/i/api/graphql/';
const apiEndpoint = apiBase + '2ICDjqPd81tulZcYrtpTuQ/TweetResultByRestId';

export const TwitterShortExtractor = new Extractor({
  id: 'twitter',
  displayName: 'Twitter (Short)',
  urlPattern: /https?:\/\/t\.co\/(?<id>\w+)/,
  host: ['t'],
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const resp = await ctx.fetch('GET', ctx.contentUrl);
    const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const match = body.match(/https?:\/\/(?:fx|vx|fixup)?(twitter|x)\.com\/([^\/]+)\/status\/(\d+)/);
    if (!match) return {};
    return { url: match[0] };
  },
});

export const TwitterExtractor = new Extractor({
  id: 'twitter',
  displayName: 'Twitter (X)',
  urlPattern: /https?:\/\/(?:fx|vx|fixup)?(twitter|x)\.com\/([^\/]+)\/status\/(?<id>\d+)/,
  host: ['x', 'twitter', 'fxtwitter', 'vxtwitter', 'fixuptwitter', 'fixupx'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await mediaFromAPI(ctx);
    return { media: media ?? undefined };
  },
});

interface TweetVariant {
  url?: string;
  content_type?: string;
  bitrate?: number;
}

interface TweetMediaEntity {
  type: string;
  media_url_https: string;
  video_info?: {
    variants?: TweetVariant[];
  };
}

interface TweetLegacy {
  full_text?: string;
  extended_entities?: { media?: TweetMediaEntity[] };
  entities?: { media?: TweetMediaEntity[] };
}

async function mediaFromAPI(ctx: ExtractorContext): Promise<Media | null> {
  if (!ctx.httpClient.cookies?.length) {
    throw Errors.AuthenticationNeeded;
  }

  const tweetData = await getTweetAPI(ctx);
  if (!tweetData) return null;

  const media = ctx.newMedia();
  const caption = sanitizeCaption(tweetData.full_text || '');
  media.setCaption(caption);

  const mediaEntities: TweetMediaEntity[] =
    tweetData.extended_entities?.media ||
    tweetData.entities?.media ||
    [];

  if (!mediaEntities.length) return null;

  for (const entity of mediaEntities) {
    const item = media.newItem();
    if (entity.type === 'photo') {
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
      mf.url = [entity.media_url_https + '?format=jpg&name=large'];
      item.addFormats(mf);
    } else if (entity.type === 'video' || entity.type === 'animated_gif') {
      const variants: TweetVariant[] = entity.video_info?.variants || [];
      for (const v of variants) {
        if (!v.url || v.content_type === 'application/x-mpegURL') continue;
        const mf = new MediaFormat();
        mf.type = MediaType.Video;
        mf.formatId = v.bitrate?.toString() || 'video';
        mf.url = [v.url];
        mf.videoCodec = MediaCodec.Avc;
        mf.audioCodec = MediaCodec.Aac;
        mf.bitrate = v.bitrate || 0;
        item.addFormats(mf);
      }
    }
  }

  return media.items.length ? media : null;
}

async function getTweetAPI(ctx: ExtractorContext): Promise<TweetLegacy | null> {
  const tweetId = ctx.contentId;
  const cookies = ctx.httpClient.cookies;
  const headers = buildApiHeaders(cookies);
  if (!headers) throw new Error('invalid auth cookies');

  const query = buildApiQuery(tweetId);
  const url = `${apiEndpoint}?${query}`;

  const resp = await ctx.fetch('GET', url, { headers });
  if (resp.status !== 200) throw new Error(`invalid response: ${resp.status}`);

  const result = resp.data?.data?.tweetResult?.result;
  if (!result) throw Errors.Unavailable;
  if (result.__typename === 'TweetUnavailable') throw Errors.Unavailable;

  return result.tweet?.legacy || result.legacy || null;
}

function buildApiHeaders(cookies: Cookie[] | undefined | null): Record<string, string> | null {
  if (!cookies) return null;
  const cookieMap: Record<string, string> = {};
  for (const c of cookies) { cookieMap[c.name] = c.value; }
  if (!cookieMap['auth_token'] || !cookieMap['ct0']) return null;
  return {
    'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    'X-Csrf-Token': cookieMap['ct0'],
    'Cookie': cookies.map(c => `${c.name}=${c.value}`).join('; '),
  };
}

function buildApiQuery(tweetId: string): string {
  const variables = JSON.stringify({
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  });
  const features = JSON.stringify({
    creator_subscriptions_tweet_preview_api_enabled: true,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });
  return `variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
}

function sanitizeCaption(text: string): string {
  return text.replace(/https?:\/\/t\.co\/\S+/g, '').trim();
}
