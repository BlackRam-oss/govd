import { Extractor, MediaFormat, DownloadSettings, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

const UA_FULL = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const UA_SHORT = UA_FULL.split(' Chrome/1')[0];

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

    // prefer Location header — well-formed URL, no HTML entities
    url = res.headers.get('location');

    // fallback: parse <a href="..."> from body (HTML-encoded — unescape &amp;)
    if (!url) {
      const body = await res.text().catch(() => '');
      if (body.startsWith('<a href="https://')) {
        const raw = body.split('<a href="')[1]?.split('"')[0] ?? null;
        if (raw) url = raw.replace(/&amp;/g, '&');
      }
    }

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

const PAGE_HEADERS = {
  'user-agent': UA_FULL,
  'accept-language': 'en-US,en;q=0.9',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-user': '?1',
  'sec-fetch-dest': 'document',
  'upgrade-insecure-requests': '1',
  'cache-control': 'max-age=0',
};

async function fetchItemStructFromAPI(contentId: string, cookies: string): Promise<TikTokItemStruct> {
  const params = new URLSearchParams({
    itemId: contentId,
    aid: '1988',
    app_language: 'en-US',
    browser_language: 'en-US',
    channel: 'tiktok_web',
    device_platform: 'web_pc',
    os: 'windows',
    region: 'US',
    screen_height: '1080',
    screen_width: '1920',
    webcast_language: 'en-US',
  });

  const res = await fetch(`https://www.tiktok.com/api/item/detail/?${params}`, {
    headers: {
      'user-agent': UA_FULL,
      'accept': 'application/json, text/plain, */*',
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': `https://www.tiktok.com/@i/video/${contentId}`,
      ...(cookies ? { cookie: cookies } : {}),
    },
  });

  const body = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json') && !body.trimStart().startsWith('{')) {
    logger.warn({ apiStatus: res.status, contentType, snippet: body.slice(0, 500) }, 'tiktok: api returned non-json');
    throw new Error(`api returned non-json (status ${res.status})`);
  }

  const data = JSON.parse(body) as { statusCode?: number; itemInfo?: TikTokVideoDetail['itemInfo'] };
  logger.info({ apiStatus: res.status, statusCode: data.statusCode, hasItemInfo: !!data.itemInfo }, 'tiktok: api response');

  if (data.statusCode !== 0 && data.statusCode !== undefined) throw new Error(`api statusCode ${data.statusCode}`);

  const itemStruct = data.itemInfo?.itemStruct;
  if (!itemStruct) throw new Error('itemStruct not found in api response');
  if (data.itemInfo?.statusMsg) throw Errors.Unavailable;
  if (itemStruct.isContentClassified) throw Errors.AgeRestricted;

  return itemStruct;
}

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  const pageUrl = ctx.contentUrl.includes('/video/') || ctx.contentUrl.includes('/photo/')
    ? ctx.contentUrl
    : `https://www.tiktok.com/@i/video/${ctx.contentId}`;

  const res = await fetch(pageUrl, { headers: PAGE_HEADERS });
  let cookieHeader = mergeCookies('', getSetCookies(res.headers));
  const html = await res.text();

  // Detect login redirect — TikTok geo-restricts or requires auth
  try {
    if (res.url && new URL(res.url).pathname.startsWith('/login')) {
      throw Errors.AuthenticationNeeded;
    }
  } catch (e) {
    if ((e as { id?: string }).id) throw e;
  }

  let detail: TikTokItemStruct;

  if (html.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__')) {
    // Happy path: parse embedded JSON from the page
    try {
      const json = html
        .split('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')[1]
        ?.split('</script>')[0];

      if (!json) throw new Error('split returned empty');

      const data = JSON.parse(json) as Record<string, unknown>;
      const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown>;
      const videoDetail = scope?.['webapp.video-detail'] as TikTokVideoDetail | undefined;

      if (!videoDetail) throw new Error('webapp.video-detail not found');
      if (videoDetail.statusMsg) throw Errors.Unavailable;

      const itemStruct = videoDetail.itemInfo?.itemStruct;
      if (!itemStruct) throw new Error('itemStruct not found');
      if (videoDetail.itemInfo?.statusMsg) throw Errors.Unavailable;
      if (itemStruct.isContentClassified) throw Errors.AgeRestricted;

      detail = itemStruct;
    } catch (e) {
      if ((e as { id?: string }).id) throw e;
      throw new Error(`tiktok: parse error — ${(e as Error).message}`);
    }
  } else {
    // WAF challenge or missing script — fall back to the internal JSON API
    const isWaf = html.includes('slardar-config');
    logger.info({ contentId: ctx.contentId, isWaf, status: res.status }, 'tiktok: html missing rehydration data, trying api');
    try {
      detail = await fetchItemStructFromAPI(ctx.contentId, cookieHeader);
    } catch (e) {
      if ((e as { id?: string }).id) throw e;
      logger.warn({ snippet: html.slice(0, 500) }, 'tiktok: api fallback failed');
      throw new Error(`tiktok: parse error — api fallback: ${(e as Error).message}`);
    }
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
    hasVideo: !!detail.video?.playAddr,
  }, 'tiktok: media type detected');

  if (!isImageSlide) {
    const video = detail.video;
    if (!video?.playAddr) throw Errors.Unavailable;

    // Prefer H.264 from bitrateInfo; fall back to H.265, then playAddr
    const bitrateEntries = video.bitrateInfo ?? [];
    const h264Entry = bitrateEntries.find(
      b => b.CodecType && !b.CodecType.includes('h265') && !b.CodecType.includes('bytevc1')
    );
    const h265Entry = bitrateEntries.find(
      b => b.CodecType?.includes('h265') || b.CodecType?.includes('bytevc1')
    );

    const bestEntry = h264Entry ?? h265Entry;
    const urls: string[] =
      bestEntry?.PlayAddr?.UrlList?.length
        ? bestEntry.PlayAddr.UrlList
        : (video.playAddr.urlList ?? []);

    if (!urls.length) throw Errors.Unavailable;

    const item = media.newItem();
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = video.playAddr.uri || 'video';
    mf.url = urls;
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = video.playAddr.width ?? 0;
    mf.height = video.playAddr.height ?? 0;
    mf.duration = video.duration ?? 0;
    mf.downloadSettings = new DownloadSettings({ headers: downloadHeaders });
    item.addFormats(mf);
  } else {
    // cobalt: prefer .jpeg? URLs from the urlList for each image
    for (const image of (detail.imagePost?.images ?? [])) {
      const urlList = image.imageURL?.urlList ?? [];
      if (!urlList.length) continue;

      // cobalt: pick the .jpeg? URL; fall back to first URL if none found
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
