import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import { Cookie } from '../../networking/index.js';
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
  let details: unknown, cookies: Cookie[] | undefined, err: Error | undefined;
  for (let i = 0; i < 5; i++) {
    try {
      [details, cookies] = await getVideoWeb(ctx);
      err = undefined;
      break;
    } catch (e) {
      err = e as Error;
      logger.warn({ attempt: i + 1, err: err.message }, 'tiktok: getVideoWeb failed');
    }
  }
  if (err) throw new Error(`failed to get from web: ${err.message}`);

  const d = details as TikTokItemStruct;
  const media = ctx.newMedia();
  media.setCaption(d.desc);

  const isImageSlide = !!d.imagePost;

  if (!isImageSlide) {
    const item = media.newItem();
    const video = d.video;
    if (video?.playAddr?.urlList?.length) {
      const mf = new MediaFormat();
      mf.type = MediaType.Video;
      mf.formatId = video.playAddr.uri || 'video';
      mf.url = video.playAddr.urlList;
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.width = video.playAddr.width || 0;
      mf.height = video.playAddr.height || 0;
      mf.duration = video.duration || 0;
      mf.downloadSettings = new DownloadSettings({ cookies });
      item.addFormats(mf);
    } else {
      throw Errors.Unavailable;
    }
  } else {
    for (const image of (d.imagePost?.images || [])) {
      const item = media.newItem();
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'image';
      mf.url = image.url?.urlList || [];
      item.addFormats(mf);
    }
  }

  return media;
}

async function getVideoWeb(ctx: ExtractorContext): Promise<[TikTokItemStruct, Cookie[]]> {
  const videoId = ctx.contentId;
  const url = `https://www.tiktok.com/@placeholder/video/${videoId}`;

  const resp = await ctx.fetch('GET', url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tiktok.com/',
    },
    responseType: 'text',
  });

  const html = resp.data as string;

  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    logger.warn({ status: resp.status, htmlSnippet: html.slice(0, 300) }, 'tiktok: universal data not found');
    throw new Error('universal data not found');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error('failed to parse tiktok data');
  }

  const p = parsed as Record<string, unknown>;
  const itemStruct =
    (p?.['__DEFAULT_SCOPE__'] as Record<string, unknown>)?.['webapp.video-detail'] as TikTokVideoDetail | undefined;
  const detailFromScope = itemStruct?.itemInfo?.itemStruct;
  const detailFallback = (p?.itemInfo as { itemStruct?: TikTokItemStruct } | undefined)?.itemStruct;
  const detail = detailFromScope || detailFallback;

  if (!detail) throw new Error('itemStruct not found');

  const cookies = resp.headers['set-cookie']
    ? parseCookies(resp.headers['set-cookie'] as string | string[])
    : [];

  return [detail, cookies];
}

function parseCookies(setCookieHeaders: string | string[]): Cookie[] {
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return list.map(h => {
    const [pair] = h.split(';');
    const [name, ...rest] = pair.split('=');
    return { name: name.trim(), value: rest.join('=').trim() };
  });
}

interface TikTokPlayAddr {
  uri: string;
  urlList: string[];
  width: number;
  height: number;
}

interface TikTokVideo {
  playAddr: TikTokPlayAddr;
  duration: number;
}

interface TikTokImageUrl {
  urlList: string[];
}

interface TikTokImage {
  url: TikTokImageUrl;
}

interface TikTokImagePost {
  images: TikTokImage[];
}

interface TikTokItemStruct {
  desc: string;
  video?: TikTokVideo;
  imagePost?: TikTokImagePost;
}

interface TikTokVideoDetail {
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
  };
}
