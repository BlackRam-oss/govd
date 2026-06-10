import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

// Same UA as cobalt — stripped for redirect, full for page fetch
const UA_FULL = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_SHORT = UA_FULL.split(' Chrome/1')[0];

export const TikTokVMExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok VM',
  urlPattern: /https:\/\/((?:vm|vt|www)\.)?(?:vx)?tiktok\.com\/(?:t\/)?(?<id>[a-zA-Z0-9-]+)/,
  host: ['tiktok', 'vxtiktok'],
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    // cobalt approach: redirect:"manual", parse <a href="..."> from body
    const res = await fetch(ctx.contentUrl, {
      redirect: 'manual',
      headers: { 'user-agent': UA_SHORT },
    });

    let url: string | null = null;

    const body = await res.text().catch(() => '');
    if (body.startsWith('<a href="https://')) {
      url = body.split('<a href="')[1]?.split('"')[0] ?? null;
    }

    // fallback: Location header
    if (!url) url = res.headers.get('location');
    // fallback: native fetch response.url (after any redirect)
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
  let detail: TikTokItemStruct | undefined;
  let cookieHeader = '';
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      [detail, cookieHeader] = await fetchVideoDetail(ctx.contentId, cookieHeader);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e as Error;
      logger.warn({ attempt: attempt + 1, err: lastErr.message }, 'tiktok: fetch attempt failed');
    }
  }

  if (!detail) throw new Error(`tiktok: all attempts failed — ${lastErr?.message}`);

  const media = ctx.newMedia();
  media.setCaption(detail.desc ?? '');

  const isImageSlide = !!detail.imagePost;

  if (!isImageSlide) {
    const video = detail.video;
    if (!video?.playAddr) throw Errors.Unavailable;

    // cobalt: prefer H.265 if available
    const h265 = detail.video?.bitrateInfo?.find(b => b.CodecType?.includes('h265'))?.PlayAddr?.UrlList?.[0];
    const urls = h265 ? [h265] : (video.playAddr.urlList ?? []);
    if (!urls.length) throw Errors.Unavailable;

    const item = media.newItem();
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = video.playAddr.uri || 'video';
    mf.url = urls;
    mf.videoCodec = h265 ? MediaCodec.Hevc : MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = video.playAddr.width ?? 0;
    mf.height = video.playAddr.height ?? 0;
    mf.duration = video.duration ?? 0;
    mf.downloadSettings = new DownloadSettings({
      headers: {
        Referer: 'https://www.tiktok.com/',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    item.addFormats(mf);
  } else {
    // cobalt: image URL is under imageURL.urlList (not url.urlList)
    for (const image of (detail.imagePost?.images ?? [])) {
      const urlList = image.imageURL?.urlList ?? [];
      if (!urlList.length) continue;
      const item = media.newItem();
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'image';
      mf.url = urlList;
      item.addFormats(mf);
    }
  }

  return media;
}

async function fetchVideoDetail(videoId: string, existingCookies: string): Promise<[TikTokItemStruct, string]> {
  // cobalt uses @i/video/ — more reliable than @placeholder/video/
  const res = await fetch(`https://www.tiktok.com/@i/video/${videoId}`, {
    headers: {
      'user-agent': UA_FULL,
      'accept-language': 'en-US,en;q=0.9',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'referer': 'https://www.tiktok.com/',
      ...(existingCookies ? { cookie: existingCookies } : {}),
    },
  });

  // Accumulate cookies for download auth
  const updatedCookies = mergeCookies(existingCookies, getSetCookies(res.headers));

  const html = await res.text();

  let detail: TikTokItemStruct;
  try {
    // cobalt uses split() — avoids regex backtracking on large HTML
    const json = html
      .split('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')[1]
      ?.split('</script>')[0];

    if (!json) {
      logger.warn({ status: res.status, snippet: html.slice(0, 400) }, 'tiktok: universal data script not found');
      throw new Error('universal data script not found');
    }

    const data = JSON.parse(json) as Record<string, unknown>;
    const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;
    const videoDetail = scope?.['webapp.video-detail'] as TikTokVideoDetail | undefined;

    if (!videoDetail) throw new Error('webapp.video-detail not found');
    if (videoDetail.statusMsg) throw Errors.Unavailable; // deleted / restricted

    const itemStruct = videoDetail.itemInfo?.itemStruct;
    if (!itemStruct) throw new Error('itemStruct not found');
    if (videoDetail.itemInfo?.statusMsg) throw Errors.Unavailable;

    detail = itemStruct;
  } catch (e) {
    if ((e as { id?: string }).id) throw e;
    throw new Error(`parse error: ${(e as Error).message}`);
  }

  return [detail, updatedCookies];
}

function getSetCookies(headers: Headers): string[] {
  // getSetCookie() is a modern Web API available in CF Workers
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

interface TikTokBitrateInfo {
  CodecType?: string;
  PlayAddr?: { UrlList?: string[] };
}

interface TikTokVideo {
  playAddr?: TikTokPlayAddr;
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

interface TikTokVideoDetail {
  statusMsg?: string;
  itemInfo?: {
    itemStruct?: TikTokItemStruct;
    statusMsg?: string;
  };
}
