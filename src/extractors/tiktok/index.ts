import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import type { Cookie } from '../../networking/index.js';
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
  let details: TikTokItemStruct | undefined;
  let cookies: Cookie[] | undefined;
  let lastErr: Error | undefined;

  for (let i = 0; i < 5; i++) {
    try {
      [details, cookies] = await getVideoWeb(ctx);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e as Error;
      logger.warn({ attempt: i + 1, err: lastErr.message }, 'tiktok: getVideoWeb failed');
    }
  }
  if (!details) throw new Error(`failed to get video data: ${lastErr?.message}`);

  const media = ctx.newMedia();
  media.setCaption(details.desc ?? '');

  const isImageSlide = !!details.imagePost;

  if (!isImageSlide) {
    const item = media.newItem();
    const video = details.video;
    if (!video?.playAddr?.urlList?.length) throw Errors.Unavailable;

    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = video.playAddr.uri || 'video';
    mf.url = video.playAddr.urlList;
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = video.playAddr.width ?? 0;
    mf.height = video.playAddr.height ?? 0;
    mf.duration = video.duration ?? 0;
    mf.downloadSettings = new DownloadSettings({
      cookies,
      headers: { Referer: 'https://www.tiktok.com/' },
    });
    item.addFormats(mf);
  } else {
    for (const image of (details.imagePost?.images ?? [])) {
      const item = media.newItem();
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'image';
      mf.url = image.url?.urlList ?? [];
      item.addFormats(mf);
    }
  }

  return media;
}

async function getVideoWeb(ctx: ExtractorContext): Promise<[TikTokItemStruct, Cookie[]]> {
  const url = `https://www.tiktok.com/@placeholder/video/${ctx.contentId}`;

  const resp = await ctx.fetch('GET', url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.tiktok.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    responseType: 'text',
  });

  const html = resp.data as string;

  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    logger.warn({ status: resp.status, htmlSnippet: html.slice(0, 300) }, 'tiktok: universal data not found');
    throw new Error('universal data script not found in page');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error('failed to parse tiktok JSON data');
  }

  const p = parsed as Record<string, unknown>;
  const scope = p?.['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
  const detail = (scope?.['webapp.video-detail'] as TikTokVideoDetail | undefined)?.itemInfo?.itemStruct
    ?? (p?.itemInfo as { itemStruct?: TikTokItemStruct } | undefined)?.itemStruct;

  if (!detail) throw new Error('itemStruct not found in universal data');

  const setCookie = resp.headers?.['set-cookie'];
  const cookies = setCookie ? parseCookies(setCookie as string | string[]) : [];

  return [detail, cookies];
}

function parseCookies(header: string | string[]): Cookie[] {
  const list = Array.isArray(header) ? header : [header];
  return list.map(h => {
    const [pair] = h.split(';');
    const [name, ...rest] = pair.split('=');
    return { name: name.trim(), value: rest.join('=').trim() };
  });
}

interface TikTokPlayAddr {
  uri: string;
  urlList: string[];
  width?: number;
  height?: number;
}

interface TikTokVideo {
  playAddr: TikTokPlayAddr;
  duration?: number;
}

interface TikTokImageUrl { urlList: string[]; }
interface TikTokImage { url?: TikTokImageUrl; }
interface TikTokImagePost { images?: TikTokImage[]; }

interface TikTokItemStruct {
  desc?: string;
  video?: TikTokVideo;
  imagePost?: TikTokImagePost;
}

interface TikTokVideoDetail {
  itemInfo?: { itemStruct?: TikTokItemStruct };
}
