import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import { Env } from '../../config/index.js';
import logger from '../../logger/index.js';

function parseNetscapeCookies(text: string): string {
  const cookies: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const parts = t.split('\t');
    if (parts.length >= 7) cookies[parts[5]] = parts[6];
  }
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookieEnv(raw: string): string {
  if (!raw) return '';
  const t = raw.trim();
  return (t.startsWith('#') || t.includes('\t')) ? parseNetscapeCookies(t) : t;
}

const TIKTOK_COOKIE = parseCookieEnv(Env.TikTokCookies) || undefined;

// UA for VM short-link resolution only (follow redirect)
const UA_SHORT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// UA for page fetch when NO session cookies are configured.
// Authenticated sessions (with cookie): omit UA entirely → webapp.video-detail (full bitrateInfo).
// Anonymous (no cookie): Dalvik UA → webapp.reflow.video.detail (basic playAddr).
// Chrome/desktop UA always triggers SlardarWAF from server IPs, regardless of cookies.
const UA_ANON = 'Dalvik/2.1.0 (Linux; U; Android 10; SM-G975U Build/QP1A.190711.020)';

export const TikTokVMExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok VM',
  urlPattern: /https:\/\/((?:vm|vt|www)\.)?(?:vx)?tiktok\.com\/(?:t\/)?(?<id>[a-zA-Z0-9-]+)/,
  host: ['tiktok', 'vxtiktok'],
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const res = await fetch(ctx.contentUrl, {
      redirect: 'manual',
      headers: { 'user-agent': UA_SHORT },
    });

    let url: string | null = res.headers.get('location');

    if (!url) {
      const body = await res.text().catch(() => '');
      if (body.startsWith('<a href="https://')) {
        const raw = body.split('<a href="')[1]?.split('"')[0] ?? null;
        if (raw) url = raw.replace(/&amp;/g, '&');
      }
    }

    if (!url) url = res.url !== ctx.contentUrl ? res.url : null;
    if (!url) throw new Error('could not resolve short tiktok url');

    try {
      const parsed = new URL(url);
      if (parsed.pathname === '/login') {
        const realURL = parsed.searchParams.get('redirect_url');
        if (!realURL) throw Errors.GeoRestricted;
        url = realURL;
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
  // With session cookies: omit UA → TikTok returns webapp.video-detail (full bitrateInfo, no WAF).
  // Without cookies: use Dalvik UA → TikTok returns webapp.reflow.video.detail (basic playAddr).
  const reqHeaders: Record<string, string> = {
    'accept-language': 'en-US,en;q=0.9',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'referer': 'https://www.tiktok.com/',
  };
  if (!TIKTOK_COOKIE) reqHeaders['user-agent'] = UA_ANON;
  if (TIKTOK_COOKIE) reqHeaders['cookie'] = TIKTOK_COOKIE;

  const fetchUrl = `https://www.tiktok.com/@i/video/${ctx.contentId}`;
  const res = await fetch(fetchUrl, { headers: reqHeaders });

  const cookieHeader = mergeCookies(TIKTOK_COOKIE ?? '', getSetCookies(res.headers));
  const html = await res.text();

  try {
    if (res.url && new URL(res.url).pathname.startsWith('/login')) {
      throw Errors.AuthenticationNeeded;
    }
  } catch (e) {
    if ((e as { id?: string }).id) throw e;
  }

  let detail: TikTokItemStruct;
  try {
    const scriptTag = html.split('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')[1];
    const json = scriptTag?.split('</script>')[0];

    if (!json) {
      const isWAF = html.includes('SlardarWAF') || html.length < 2000;
      logger.warn({ status: res.status, size: html.length, isWAF, hasCookie: !!TIKTOK_COOKIE }, 'tiktok: universal data script not found');
      if (isWAF) throw new Error('tiktok WAF — add TIKTOK_COOKIES secret or try a different proxy');
      throw new Error('universal data script not found');
    }

    const data = JSON.parse(json) as Record<string, unknown>;
    const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;

    // Authenticated (no UA + cookies) → webapp.video-detail with bitrateInfo
    // Anonymous (Dalvik UA, no cookies) → webapp.reflow.video.detail with basic playAddr
    const videoDetail = scope?.['webapp.video-detail'] as TikTokVideoDetail | undefined;
    const reflowDetail = scope?.['webapp.reflow.video.detail'] as TikTokReflowDetail | undefined;

    let itemStruct: TikTokItemStruct | undefined;

    if (videoDetail) {
      if (videoDetail.statusMsg) throw Errors.Unavailable;
      if (videoDetail.itemInfo?.statusMsg) throw Errors.Unavailable;
      itemStruct = videoDetail.itemInfo?.itemStruct;
    } else if (reflowDetail) {
      if (reflowDetail.statusCode !== 0) throw Errors.Unavailable;
      itemStruct = reflowDetail.itemInfo?.itemStruct;
    } else {
      const keys = Object.keys(scope || {});
      logger.warn({ keys, hasCookie: !!TIKTOK_COOKIE }, 'tiktok: no video detail scope found');
      throw new Error(`no video detail scope (got: ${keys.slice(0, 3).join(', ')})`);
    }

    if (!itemStruct) throw new Error('itemStruct not found');
    if (itemStruct.isContentClassified) throw Errors.AgeRestricted;

    detail = itemStruct;
  } catch (e) {
    if ((e as { id?: string }).id) throw e;
    throw new Error(`tiktok: parse error — ${(e as Error).message}`);
  }

  const media = ctx.newMedia();
  media.setCaption(detail.desc ?? '');

  const downloadHeaders: Record<string, string> = {
    Referer: 'https://www.tiktok.com/',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const isImageSlide = !!detail.imagePost;
  logger.info({
    postId: ctx.contentId,
    isImageSlide,
    imageCount: detail.imagePost?.images?.length ?? 0,
    hasVideo: !!detail.video,
  }, 'tiktok: media type detected');

  if (!isImageSlide) {
    const video = detail.video;
    if (!video) throw Errors.Unavailable;

    const playAddrObj = typeof video.playAddr === 'object' ? video.playAddr : null;
    const playAddrStruct = video.PlayAddrStruct;
    const bitrateEntries = video.bitrateInfo ?? [];

    const h264Entry = bitrateEntries.find(
      b => b.CodecType && !b.CodecType.includes('h265') && !b.CodecType.includes('bytevc1')
    );
    const h265Entry = bitrateEntries.find(
      b => b.CodecType?.includes('h265') || b.CodecType?.includes('bytevc1')
    );
    const bestEntry = h264Entry ?? h265Entry;

    let urls: string[];
    if (bestEntry?.PlayAddr?.UrlList?.length) {
      urls = bestEntry.PlayAddr.UrlList;
    } else if (playAddrStruct?.UrlList?.length) {
      urls = playAddrStruct.UrlList;
    } else if (typeof video.playAddr === 'string' && video.playAddr) {
      urls = [video.playAddr];
    } else if (playAddrObj?.urlList?.length) {
      urls = playAddrObj.urlList;
    } else {
      urls = [];
    }

    if (!urls.length) throw Errors.Unavailable;

    const item = media.newItem();
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = video.id || video.videoID || playAddrStruct?.Uri || playAddrObj?.uri || 'video';
    mf.url = urls;
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = video.width ?? playAddrStruct?.Width ?? bestEntry?.PlayAddr?.Width ?? playAddrObj?.width ?? 0;
    mf.height = video.height ?? playAddrStruct?.Height ?? bestEntry?.PlayAddr?.Height ?? playAddrObj?.height ?? 0;
    mf.duration = video.duration ?? 0;
    mf.downloadSettings = new DownloadSettings({ headers: downloadHeaders });
    item.addFormats(mf);
  } else {
    for (const image of (detail.imagePost?.images ?? [])) {
      const urlList = image.imageURL?.urlList ?? [];
      if (!urlList.length) continue;
      const url = urlList.find(u => u.includes('.jpeg?')) ?? urlList[0];
      if (!url) continue;
      const item = media.newItem();
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'image';
      mf.url = [url];
      mf.downloadSettings = new DownloadSettings({ headers: downloadHeaders });
      item.addFormats(mf);
    }
  }

  if (!media.items.length) throw Errors.Unavailable;
  return media;
}

function getSetCookies(headers: Headers): string[] {
  if (typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(existing: string, setCookies: string[]): string {
  const map: Record<string, string> = {};
  for (const pair of existing.split(';').map(s => s.trim()).filter(Boolean)) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  for (const header of setCookies) {
    const [part] = header.split(';');
    const i = part.indexOf('=');
    if (i < 0) continue;
    map[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TikTokPlayAddr {
  uri: string;
  urlList: string[];
  width?: number;
  height?: number;
}

interface TikTokPlayAddrStruct {
  Uri?: string;
  UrlList?: string[];
  Width?: number;
  Height?: number;
}

interface TikTokBitrateInfo {
  CodecType?: string;
  PlayAddr?: { UrlList?: string[]; Width?: number; Height?: number };
}

interface TikTokVideo {
  id?: string;
  videoID?: string;
  playAddr?: TikTokPlayAddr | string;
  PlayAddrStruct?: TikTokPlayAddrStruct;
  width?: number;
  height?: number;
  duration?: number;
  bitrateInfo?: TikTokBitrateInfo[];
}

interface TikTokImageURL { urlList: string[]; }
interface TikTokImage { imageURL?: TikTokImageURL; }
interface TikTokImagePost { images?: TikTokImage[]; }

interface TikTokItemStruct {
  desc?: string;
  video?: TikTokVideo;
  imagePost?: TikTokImagePost;
  isContentClassified?: boolean;
  author?: { uniqueId?: string };
}

// Authenticated response (no UA + session cookies): webapp.video-detail
interface TikTokVideoDetail {
  statusMsg?: string;
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
    statusMsg?: string;
  };
}

// Anonymous response (Dalvik UA, no cookies): webapp.reflow.video.detail
interface TikTokReflowDetail {
  statusCode: number;
  statusMessage?: string;
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
  };
}
