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

// Android Dalvik UA bypasses TikTok's SlardarWAF (triggered by Chrome desktop UA).
// Desktop Chrome UAs consistently receive a 1155-byte JS challenge that servers cannot solve.
const UA_ANDROID = 'Dalvik/2.1.0 (Linux; U; Android 10; SM-G975U Build/QP1A.190711.020)';
// Short UA for VM redirect resolution only
const UA_SHORT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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

    let url: string | null = null;

    url = res.headers.get('location');

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
  const reqHeaders: Record<string, string> = {
    'user-agent': UA_ANDROID,
    'accept-language': 'en-US,en;q=0.9',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'referer': 'https://www.tiktok.com/',
  };
  if (TIKTOK_COOKIE) reqHeaders['cookie'] = TIKTOK_COOKIE;

  // Use @i/video/{id} — avoids username lookup and works with both UA types.
  const fetchUrl = `https://www.tiktok.com/@i/video/${ctx.contentId}`;

  const res = await fetch(fetchUrl, { headers: reqHeaders });

  // Merge response cookies with user cookies (needed for CDN video download)
  const cookieHeader = mergeCookies(TIKTOK_COOKIE ?? '', getSetCookies(res.headers));

  const html = await res.text();

  // Detect login redirect
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
      if (isWAF) throw new Error('tiktok WAF challenge — IP blocked or UA fingerprinted');
      throw new Error('universal data script not found');
    }

    const data = JSON.parse(json) as Record<string, unknown>;
    const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;

    // Android Dalvik UA → webapp.reflow.video.detail; desktop Chrome UA → webapp.video-detail
    const reflowDetail = scope?.['webapp.reflow.video.detail'] as TikTokReflowDetail | undefined;
    const videoDetail = scope?.['webapp.video-detail'] as TikTokVideoDetail | undefined;

    let itemStruct: TikTokItemStruct | undefined;

    if (reflowDetail) {
      if (reflowDetail.statusCode !== 0) throw Errors.Unavailable;
      itemStruct = reflowDetail.itemInfo?.itemStruct;
    } else if (videoDetail) {
      if (videoDetail.statusMsg) throw Errors.Unavailable;
      if (videoDetail.itemInfo?.statusMsg) throw Errors.Unavailable;
      itemStruct = videoDetail.itemInfo?.itemStruct;
    } else {
      throw new Error('no video detail scope found');
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

    // TikTok API formats:
    //   Reflow (Android UA): playAddr = string URL, no bitrateInfo
    //   Desktop (Chrome UA): playAddr = string or {uri, urlList}, bitrateInfo available
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
    const [k, ...v] = pair.split('=');
    map[k.trim()] = v.join('=').trim();
  }
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const [k, ...v] = pair.split('=');
    map[k.trim()] = v.join('=').trim();
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

// Desktop Chrome UA response
interface TikTokVideoDetail {
  statusMsg?: string;
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
    statusMsg?: string;
  };
}

// Android Dalvik UA response (different scope key: webapp.reflow.video.detail)
interface TikTokReflowDetail {
  statusCode: number;
  statusMessage?: string;
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
  };
}
