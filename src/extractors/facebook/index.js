import { Extractor, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';

const webHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const FacebookShareExtractor = new Extractor({
  id: 'facebook',
  displayName: 'Facebook (Share)',
  urlPattern: /https?:\/\/(?:(?:www|m)\.)?facebook\.com\/share\/(?:r|v|p)\/(?<id>[a-zA-Z0-9]+)/,
  host: ['facebook'],
  redirect: true,
  async getFunc(ctx) {
    const resp = await ctx.fetch('GET', ctx.contentUrl, { headers: webHeaders });
    const finalUrl = resp.request?.res?.responseUrl || ctx.contentUrl;
    return { url: finalUrl };
  },
});

export const FacebookExtractor = new Extractor({
  id: 'facebook',
  displayName: 'Facebook',
  urlPattern: /https?:\/\/(?:(?:www|m|mbasic)\.)?facebook\.com\/(?:watch\/?\?(?:[^&]*&)*v=|(?:reel|videos?|posts?)\/|[^/]+\/(?:videos|posts|reels?)\/)(?<id>[a-zA-Z0-9]+)/,
  host: ['facebook'],
  async getFunc(ctx) {
    if (!ctx.httpClient.cookies?.length) {
      throw new Error('auth cookies are required for facebook');
    }
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx) {
  const videoData = await getVideoData(ctx);
  return buildMedia(ctx, videoData);
}

async function getVideoData(ctx) {
  const videoId = ctx.contentId;
  const docId = '10015901848480474';

  const variables = JSON.stringify({ shortcode_media_id: videoId });
  const body = new URLSearchParams({
    av: '0',
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: '3',
    __hs: '',
    dpr: '1',
    __ccg: 'EXCELLENT',
    __rev: '',
    __s: '',
    __hsi: '',
    __dyn: '',
    __csr: '',
    __comet_req: '15',
    fb_dtsg: '',
    jazoest: '',
    lsd: '',
    __spin_r: '',
    __spin_b: '',
    __spin_t: '',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'CometVideoPlayerQuery',
    variables,
    server_timestamps: 'true',
    doc_id: docId,
  });

  const cookieHeader = ctx.httpClient.cookies?.map(c => `${c.name}=${c.value}`).join('; ') || '';

  const resp = await ctx.fetch('POST', 'https://www.facebook.com/api/graphql/', {
    body: body.toString(),
    headers: {
      ...webHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
    },
  });

  if (resp.status !== 200) throw new Error(`facebook api failed: ${resp.status}`);

  const data = resp.data;
  const videoNode =
    data?.data?.video ||
    data?.data?.node?.video_playback_resolution_variants ||
    null;

  // simple fallback: scrape from page
  if (!videoNode) {
    return await scrapeVideoData(ctx);
  }

  return {
    hdUrl: videoNode.browser_native_hd_url || '',
    sdUrl: videoNode.browser_native_sd_url || '',
    title: videoNode.name || '',
    width: videoNode.width || 0,
    height: videoNode.height || 0,
  };
}

async function scrapeVideoData(ctx) {
  const url = `https://www.facebook.com/watch/?v=${ctx.contentId}`;
  const cookieHeader = ctx.httpClient.cookies?.map(c => `${c.name}=${c.value}`).join('; ') || '';

  const resp = await ctx.fetch('GET', url, {
    headers: { ...webHeaders, 'Cookie': cookieHeader },
    responseType: 'text',
  });

  const html = resp.data;
  const hdMatch = html.match(/"browser_native_hd_url":"(.*?)"/);
  const sdMatch = html.match(/"browser_native_sd_url":"(.*?)"/);
  const titleMatch = html.match(/"title":"(.*?)"/);

  return {
    hdUrl: hdMatch ? hdMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '') : '',
    sdUrl: sdMatch ? sdMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '') : '',
    title: titleMatch ? titleMatch[1] : '',
    width: 0,
    height: 0,
  };
}

function buildMedia(ctx, data) {
  const media = ctx.newMedia();
  if (data.title) media.setCaption(data.title);

  const item = media.newItem();
  const formats = [];

  if (data.hdUrl) {
    const mf = new MediaFormat();
    mf.formatId = 'hd';
    mf.type = MediaType.Video;
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.url = [data.hdUrl];
    mf.width = data.width || 0;
    mf.height = data.height || 0;
    formats.push(mf);
  }

  if (data.sdUrl) {
    const mf = new MediaFormat();
    mf.formatId = 'sd';
    mf.type = MediaType.Video;
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.url = [data.sdUrl];
    formats.push(mf);
  }

  if (!formats.length) throw new Error('no facebook video formats found');
  item.addFormats(...formats);
  return media;
}
