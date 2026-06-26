import { Extractor, MediaFormat, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import { Env } from '../../config/index.js';
import logger from '../../logger/index.js';

const instagramHost: string[] = ['instagram', 'ddinstagram'];

// ── Header sets (mirrored from cobalt) ───────────────────────────────────────

const commonHeaders: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'sec-gpc': '1',
  'sec-fetch-site': 'same-origin',
  'x-ig-app-id': '936619743392459',
};

const mobileHeaders: Record<string, string> = {
  'x-ig-app-locale': 'en_US',
  'x-ig-device-locale': 'en_US',
  'x-ig-mapped-locale': 'en_US',
  'user-agent': 'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)',
  'accept-language': 'en-US',
  'x-fb-http-engine': 'Liger',
  'x-fb-client-ip': 'True',
  'x-fb-server-cluster': 'True',
  'content-length': '0',
};

const embedHeaders: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'max-age=0',
  'Dnt': '1',
  'Priority': 'u=0, i',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// ── Extractors ────────────────────────────────────────────────────────────────

export const InstagramExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/(reels?|p|tv)\/(?<id>[a-zA-Z0-9_-]+)/,
  host: instagramHost,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getPost(ctx);
    return { media };
  },
});

export const InstagramStoriesExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram Stories',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/stories\/[a-zA-Z0-9._]+\/(?<id>\d+)/,
  host: instagramHost,
  hidden: true,
  async getFunc(_ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    throw Errors.InstagramStoriesUnsupported;
  },
});

export const InstagramShareExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram (Share)',
  urlPattern: /https?:\/\/(www\.)?(?:dd)?instagram\.com\/share\/((reels?|video|s|p)\/)?(?<id>[^\/\?]+)/,
  host: instagramHost,
  redirect: true,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const url = await ctx.fetchLocation(ctx.contentUrl);
    return { url };
  },
});

// ── Mobile API ────────────────────────────────────────────────────────────────

async function getMediaId(shortcode: string, cookie?: string): Promise<string | null> {
  try {
    const url = new URL('https://i.instagram.com/api/v1/oembed/');
    url.searchParams.set('url', `https://www.instagram.com/p/${shortcode}/`);
    const headers: Record<string, string> = { ...mobileHeaders };
    if (cookie) headers['cookie'] = cookie;
    const resp = await fetch(url, { headers });
    const data = await resp.json() as any;
    if (data?.media_id) return String(data.media_id);
  } catch {
    // fall through to local decode
  }
  return shortcodeToMediaId(shortcode) || null;
}

async function requestMobileApi(mediaId: string, cookie?: string): Promise<any | null> {
  try {
    const headers: Record<string, string> = { ...mobileHeaders };
    if (cookie) headers['cookie'] = cookie;
    const resp = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, { headers });
    const data = await resp.json() as any;
    return data?.items?.[0] ?? null;
  } catch {
    return null;
  }
}

// ── Embed HTML ────────────────────────────────────────────────────────────────

async function requestHTML(shortcode: string, cookie?: string): Promise<any | null> {
  try {
    const headers: Record<string, string> = { ...embedHeaders };
    if (cookie) headers['cookie'] = cookie;
    const resp = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, { headers });
    const html = await resp.text();

    const match = html.match(/"init",\[\],\[(.*?)\]\],/);
    if (!match) return null;

    let embedData: any;
    try { embedData = JSON.parse(match[1]); } catch { return null; }
    if (!embedData?.contextJSON) return null;

    try { return JSON.parse(embedData.contextJSON); } catch { return null; }
  } catch {
    return null;
  }
}

// ── GQL (builds anon or authenticated session from page HTML) ─────────────────

function getNumberFromQuery(name: string, data: string): number | undefined {
  const s = data.match(new RegExp(name + '=(\\d+)'))?.[1];
  if (s && +s) return +s;
}

function getObjectFromEntries(name: string, data: string): any | null {
  const obj = data.match(new RegExp('\\["' + name + '",.*?,({.*?}),\\d+\\]'))?.[1];
  return obj ? JSON.parse(obj) : null;
}

async function getGQLParams(
  shortcode: string,
  cookie?: string,
): Promise<{ headers: Record<string, string>; body: Record<string, any> } | null> {
  try {
    const reqHeaders: Record<string, string> = { ...embedHeaders };
    if (cookie) reqHeaders['cookie'] = cookie;

    const resp = await fetch(`https://www.instagram.com/p/${shortcode}/`, { headers: reqHeaders });
    const html = await resp.text();

    const siteData         = getObjectFromEntries('SiteData', html);
    const polarisSiteData  = getObjectFromEntries('PolarisSiteData', html);
    const webConfig        = getObjectFromEntries('DGWWebConfig', html);
    const pushInfo         = getObjectFromEntries('InstagramWebPushInfo', html);
    const lsd              = getObjectFromEntries('LSD', html)?.token ?? randomB64(8);
    const csrf             = getObjectFromEntries('InstagramSecurityConfig', html)?.csrf_token;

    // When a session cookie is provided, use it directly; otherwise build an anon cookie.
    const anonCookie = cookie ?? [
      csrf && `csrftoken=${csrf}`,
      polarisSiteData?.device_id && `ig_did=${polarisSiteData.device_id}`,
      'wd=1280x720',
      'dpr=2',
      polarisSiteData?.machine_id && `mid=${polarisSiteData.machine_id}`,
      'ig_nrcb=1',
    ].filter(Boolean).join('; ');

    return {
      headers: {
        'x-ig-app-id': webConfig?.appId ?? '936619743392459',
        'X-FB-LSD': lsd,
        'X-CSRFToken': csrf ?? '',
        'X-Bloks-Version-Id': getObjectFromEntries('WebBloksVersioningID', html)?.versioningID ?? '',
        'x-asbd-id': '129477',
        cookie: anonCookie,
      },
      body: {
        __d: 'www',
        __a: '1',
        __s: '::' + Math.random().toString(36).slice(2).replace(/\d/g, '').slice(0, 6),
        __hs: siteData?.haste_session ?? '20126.HYP:instagram_web_pkg.2.1...0',
        __req: 'b',
        __ccg: 'EXCELLENT',
        __rev: pushInfo?.rollout_hash ?? '1019933358',
        __hsi: siteData?.hsi ?? '7436540909012459023',
        __dyn: randomB64(154),
        __csr: randomB64(154),
        __user: '0',
        __comet_req: getNumberFromQuery('__comet_req', html) ?? '7',
        av: '0',
        dpr: '2',
        lsd,
        jazoest: getNumberFromQuery('jazoest', html) ?? Math.floor(Math.random() * 10000),
        __spin_r: siteData?.__spin_r ?? '1019933358',
        __spin_b: siteData?.__spin_b ?? 'trunk',
        __spin_t: siteData?.__spin_t ?? Math.floor(Date.now() / 1000),
      },
    };
  } catch {
    return null;
  }
}

async function requestGQL(shortcode: string, cookie?: string): Promise<{ gql_data: any } | null> {
  try {
    const params = await getGQLParams(shortcode, cookie);
    if (!params) return null;

    const { headers, body } = params;

    const resp = await fetch('https://www.instagram.com/graphql/query', {
      method: 'POST',
      headers: {
        ...embedHeaders,
        ...headers,
        'content-type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
      },
      body: new URLSearchParams({
        ...body,
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
        variables: JSON.stringify({
          shortcode,
          fetch_tagged_user_count: null,
          hoisted_comment_id: null,
          hoisted_reply_id: null,
        }),
        server_timestamps: 'true',
        doc_id: '8845758582119845',
      }).toString(),
    });

    const gqlData = await resp.json().then((r: any) => r.data).catch(() => null);
    return { gql_data: gqlData };
  } catch {
    return null;
  }
}

// ── Data extraction ───────────────────────────────────────────────────────────

interface IgItem {
  isVideo: boolean;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

// cobalt: hasData — mobile API data (no gql_data key) also passes since undefined !== null
function hasData(data: any): boolean {
  return data != null
    && data.gql_data !== null
    && data?.gql_data?.xdt_shortcode_media !== null;
}

// Mobile API format
function extractNewPost(data: any): IgItem[] {
  const results: IgItem[] = [];

  const carousel: any[] = data.carousel_media ?? [];
  if (carousel.length) {
    for (const e of carousel) {
      if (!e?.image_versions2) continue;
      const thumb: string = e.image_versions2.candidates?.[0]?.url ?? '';
      if (e.video_versions?.length) {
        const best = e.video_versions.reduce((a: any, b: any) =>
          a.width * a.height < b.width * b.height ? b : a);
        results.push({ isVideo: true, url: best.url, thumbnail: thumb, width: best.width, height: best.height });
      } else {
        const img = e.image_versions2.candidates[0];
        results.push({ isVideo: false, url: img.url, width: img.width, height: img.height });
      }
    }
    return results;
  }

  if (data.video_versions?.length) {
    const best = data.video_versions.reduce((a: any, b: any) =>
      a.width * a.height < b.width * b.height ? b : a);
    const thumb = data.image_versions2?.candidates?.[0]?.url;
    results.push({ isVideo: true, url: best.url, thumbnail: thumb, width: best.width, height: best.height });
    return results;
  }

  if (data.image_versions2?.candidates?.length) {
    const img = data.image_versions2.candidates[0];
    results.push({ isVideo: false, url: img.url, width: img.width, height: img.height });
    return results;
  }

  return results;
}

// GQL / embed format
function extractOldPost(data: any): IgItem[] {
  const results: IgItem[] = [];
  const sm = data?.gql_data?.shortcode_media ?? data?.gql_data?.xdt_shortcode_media;
  if (!sm) return results;

  const sidecar = sm.edge_sidecar_to_children;
  if (sidecar?.edges?.length) {
    for (const e of sidecar.edges) {
      const node = e.node;
      if (!node?.display_url) continue;
      if (node.is_video && node.video_url) {
        results.push({
          isVideo: true,
          url: node.video_url,
          thumbnail: node.display_url,
          width: node.dimensions?.width,
          height: node.dimensions?.height,
        });
      } else {
        results.push({
          isVideo: false,
          url: node.display_url,
          width: node.dimensions?.width,
          height: node.dimensions?.height,
        });
      }
    }
    return results;
  }

  if (sm.video_url) {
    results.push({
      isVideo: true,
      url: sm.video_url,
      thumbnail: sm.display_url,
      width: sm.dimensions?.width,
      height: sm.dimensions?.height,
    });
    return results;
  }

  if (sm.display_url) {
    results.push({
      isVideo: false,
      url: sm.display_url,
      width: sm.dimensions?.width,
      height: sm.dimensions?.height,
    });
    return results;
  }

  return results;
}

// ── Error context ─────────────────────────────────────────────────────────────

async function getErrorContext(shortcode: string): Promise<Error | null> {
  try {
    const params = await getGQLParams(shortcode);
    if (!params) return null;

    const { headers, body } = params;

    const resp = await fetch('https://www.instagram.com/ajax/bulk-route-definitions/', {
      method: 'POST',
      headers: {
        ...embedHeaders,
        ...headers,
        'content-type': 'application/x-www-form-urlencoded',
        'X-Ig-D': 'www',
      },
      body: new URLSearchParams({
        'route_urls[0]': `/p/${shortcode}/`,
        routing_namespace: 'igx_www',
        ...body,
      }).toString(),
    });

    const text = await resp.text();

    if (text.includes('"tracePolicy":"polaris.privatePostPage"')) return Errors.AuthenticationNeeded;

    const [, mediaId, mediaOwnerId] = text.match(
      /"media_id":\s*?"(\d+)","media_owner_id":\s*?"(\d+)"/
    ) || [];

    if (mediaId && mediaOwnerId) {
      const rulingURL = new URL('https://www.instagram.com/api/v1/web/get_ruling_for_media_content_logged_out');
      rulingURL.searchParams.set('media_id', mediaId);
      rulingURL.searchParams.set('owner_id', mediaOwnerId);
      const ruling = await fetch(rulingURL, {
        headers: { ...headers, ...commonHeaders },
      }).then((r: any) => r.json()).catch(() => ({}));
      if (ruling?.title?.includes('Restricted')) return Errors.AgeRestricted;
    }
  } catch {
    return null;
  }
  return null;
}

// ── Main post fetcher (mirrors cobalt's getPost flow) ─────────────────────────

async function getPost(ctx: ExtractorContext): Promise<Media> {
  const shortcode = ctx.contentId;
  const cookie = Env.InstagramCookies || undefined;
  let data: any = null;

  try {
    const mediaId = await getMediaId(shortcode);
    logger.info({ shortcode, mediaId }, 'instagram: mediaId resolved');

    // — unauthenticated pass —
    if (mediaId && !hasData(data)) {
      data = await requestMobileApi(mediaId);
      logger.info({ shortcode, result: data != null ? 'ok' : 'null' }, 'instagram: mobile API');
    }
    if (!hasData(data)) {
      data = await requestHTML(shortcode);
      logger.info({ shortcode, result: data != null ? 'ok' : 'null' }, 'instagram: html embed');
    }
    if (!hasData(data)) {
      const gql = await requestGQL(shortcode);
      if (gql) data = gql;
      logger.info({ shortcode, result: hasData(data) ? 'ok' : 'null' }, 'instagram: GQL');
    }

    // — authenticated pass (only if all unauthenticated methods failed) —
    if (!hasData(data) && cookie) {
      logger.info({ shortcode }, 'instagram: falling back to cookie-authenticated methods');
      if (mediaId) {
        data = await requestMobileApi(mediaId, cookie);
        logger.info({ shortcode, result: data != null ? 'ok' : 'null' }, 'instagram: mobile API (cookie)');
      }
      if (!hasData(data)) {
        data = await requestHTML(shortcode, cookie);
        logger.info({ shortcode, result: data != null ? 'ok' : 'null' }, 'instagram: html embed (cookie)');
      }
      if (!hasData(data)) {
        const gql = await requestGQL(shortcode, cookie);
        if (gql) data = gql;
        logger.info({ shortcode, result: hasData(data) ? 'ok' : 'null' }, 'instagram: GQL (cookie)');
      }
    }
  } catch (e) {
    logger.warn({ shortcode, err: (e as Error).message }, 'instagram: unexpected error during fetch');
  }

  // build items from whichever method succeeded
  let items: IgItem[] = [];
  if (data?.gql_data) {
    items = extractOldPost(data);
    logger.info({ shortcode, itemCount: items.length }, 'instagram: resolved via GQL/embed');
  } else if (data != null) {
    items = extractNewPost(data);
    logger.info({ shortcode, itemCount: items.length }, 'instagram: resolved via mobile API');
  } else {
    logger.info({ shortcode }, 'instagram: all methods returned null');
  }

  if (!items.length) {
    logger.warn({ shortcode }, 'instagram: all methods failed');
    const contextError = await getErrorContext(shortcode);
    throw contextError ?? Errors.Unavailable;
  }

  const media = ctx.newMedia();

  for (const item of items) {
    const mi = media.newItem();
    const mf = new MediaFormat();
    mf.url = [item.url];
    mf.width = item.width ?? 0;
    mf.height = item.height ?? 0;

    if (item.isVideo) {
      mf.type = MediaType.Video;
      mf.formatId = 'video';
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      if (item.thumbnail) mf.thumbnailUrl = [item.thumbnail];
    } else {
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
    }

    mi.addFormats(mf);
  }

  return media;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomB64(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function shortcodeToMediaId(shortcode: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let n = 0n;
  for (const c of shortcode) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) return '';
    n = n * 64n + BigInt(idx);
  }
  return n.toString();
}
