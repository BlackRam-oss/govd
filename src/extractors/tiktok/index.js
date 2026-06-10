import { Extractor, MediaFormat, DownloadSettings } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';

export const TikTokVMExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok VM',
  urlPattern: /https:\/\/((?:vm|vt|www)\.)?(?:vx)?tiktok\.com\/(?:t\/)?(?<id>[a-zA-Z0-9-]+)/,
  host: ['tiktok', 'vxtiktok'],
  redirect: true,
  async getFunc(ctx) {
    const resp = await ctx.fetch('GET', ctx.contentUrl);
    const redirectUrl = resp.request?.res?.responseUrl || resp.config?.url || ctx.contentUrl;

    let url;
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
      if (e.id) throw e;
      throw new Error(`failed to parse redirect url: ${e.message}`);
    }

    return { url };
  },
});

export const TikTokExtractor = new Extractor({
  id: 'tiktok',
  displayName: 'TikTok',
  urlPattern: /https?:\/\/((www|m)\.)?(vx)?tiktok\.com\/((?:embed|@[\w\.-]*)\/)?(v(ideo)?|p(hoto)?)\/(?<id>[0-9]+)/,
  host: ['tiktok', 'vxtiktok'],
  async getFunc(ctx) {
    const media = await getMedia(ctx);
    return { url: ctx.contentUrl, media };
  },
});

async function getMedia(ctx) {
  let details, cookies, err;
  for (let i = 0; i < 5; i++) {
    try {
      [details, cookies] = await getVideoWeb(ctx);
      err = null;
      break;
    } catch (e) {
      err = e;
    }
  }
  if (err) throw new Error(`failed to get from web: ${err.message}`);

  const media = ctx.newMedia();
  media.setCaption(details.desc);

  const isImageSlide = !!details.imagePost;

  if (!isImageSlide) {
    const item = media.newItem();
    const video = details.video;
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
    for (const image of (details.imagePost?.images || [])) {
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

async function getVideoWeb(ctx) {
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

  const html = resp.data;

  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('universal data not found');

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error('failed to parse tiktok data');
  }

  const itemStruct =
    parsed?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct ||
    parsed?.itemInfo?.itemStruct;

  if (!itemStruct) throw new Error('itemStruct not found');

  const cookies = resp.headers['set-cookie']
    ? parseCookies(resp.headers['set-cookie'])
    : [];

  return [itemStruct, cookies];
}

function parseCookies(setCookieHeaders) {
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return list.map(h => {
    const [pair] = h.split(';');
    const [name, ...rest] = pair.split('=');
    return { name: name.trim(), value: rest.join('=').trim() };
  });
}
