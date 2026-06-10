import { Extractor, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

const instagramHost = ['instagram', 'ddinstagram'];
const igramHostname = 'igram.world';

const webHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

export const InstagramExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/(reels?|p|tv)\/(?<id>[a-zA-Z0-9_-]+)/,
  host: instagramHost,
  async getFunc(ctx) {
    let media, err;

    try { media = await getGQLMedia(ctx); if (media) return { media }; } catch (e) { err = e; }
    try { media = await getEmbedMedia(ctx); if (media) return { media }; } catch (e) { err = e; }
    try { media = await getIGramPost(ctx); if (media) return { media }; } catch (e) { err = e; }

    throw err || new Error('all instagram methods failed');
  },
});

export const InstagramStoriesExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram Stories',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/stories\/[a-zA-Z0-9._]+\/(?<id>\d+)/,
  host: instagramHost,
  hidden: true,
  async getFunc(ctx) {
    const media = await getIGramStory(ctx);
    return { media };
  },
});

export const InstagramShareExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram (Share)',
  urlPattern: /https?:\/\/(www\.)?(?:dd)?instagram\.com\/share\/((reels?|video|s|p)\/)?(?<id>[^\/\?]+)/,
  host: instagramHost,
  redirect: true,
  async getFunc(ctx) {
    const resp = await ctx.fetch('GET', ctx.contentUrl, { headers: webHeaders });
    const redirectUrl = resp.request?.res?.responseUrl || ctx.contentUrl;
    return { url: redirectUrl };
  },
});

async function getGQLMedia(ctx) {
  const url = `https://www.instagram.com/graphql/query/?query_hash=9f8827793ef34641b2fb195d4d41151c&variables={"shortcode":"${ctx.contentId}"}`;
  const resp = await ctx.fetch('GET', url, {
    headers: {
      ...webHeaders,
      'X-IG-App-ID': '936619743392459',
    },
  });
  if (resp.status !== 200) throw new Error(`GQL failed: ${resp.status}`);
  const shortcodeMedia = resp.data?.data?.shortcode_media;
  if (!shortcodeMedia) throw new Error('no GQL data');
  return parseGQLMedia(ctx, shortcodeMedia);
}

async function getEmbedMedia(ctx) {
  const url = `https://www.instagram.com/p/${ctx.contentId}/embed/captioned`;
  const resp = await ctx.fetch('GET', url, {
    headers: webHeaders,
    responseType: 'text',
  });
  if (resp.status !== 200) throw new Error(`embed failed: ${resp.status}`);
  const html = resp.data;
  const match = html.match(/window\.__additionalDataLoaded\('extra',(\{.*?\})\);/s) ||
                html.match(/PolarisPostRootPageQueryRelayPreloader.*?"data":(\{.*?\})/s);
  if (!match) throw new Error('embed data not found');
  try {
    const data = JSON.parse(match[1]);
    const shortcodeMedia = data?.shortcode_media || data?.data?.shortcode_media;
    if (!shortcodeMedia) throw new Error('no embed media');
    return parseGQLMedia(ctx, shortcodeMedia);
  } catch (e) {
    throw new Error(`embed parse failed: ${e.message}`);
  }
}

function parseGQLMedia(ctx, data) {
  if (!data) return null;
  const media = ctx.newMedia();
  const caption = data.edge_media_to_caption?.edges?.[0]?.node?.text || '';
  media.setCaption(caption);

  const nodes = data.__typename === 'GraphSidecar'
    ? (data.edge_sidecar_to_children?.edges || []).map(e => e.node)
    : [data];

  for (const node of nodes) {
    const item = media.newItem();
    if (node.is_video) {
      const mf = new MediaFormat();
      mf.type = MediaType.Video;
      mf.formatId = 'video';
      mf.url = [node.video_url];
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.width = node.dimensions?.width || 0;
      mf.height = node.dimensions?.height || 0;
      mf.thumbnailUrl = node.thumbnail_src ? [node.thumbnail_src] : [];
      item.addFormats(mf);
    } else {
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
      mf.url = [node.display_url];
      item.addFormats(mf);
    }
  }

  return media.items.length ? media : null;
}

async function getIGramPost(ctx) {
  const contentUrl = `https://www.instagram.com/p/${ctx.contentId}/`;
  const apiUrl = `https://${igramHostname}/api/convert`;

  const resp = await ctx.fetch('POST', apiUrl, {
    body: JSON.stringify({ url: contentUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`igram failed: ${resp.status}`);

  const data = resp.data;
  if (!data?.items?.length) throw new Error('no igram items');

  const media = ctx.newMedia();
  for (const obj of data.items) {
    const item = media.newItem();
    if (!obj.url?.[0]?.url) throw new Error('no igram url');
    const urlObj = obj.url[0];
    const mf = new MediaFormat();
    mf.url = [urlObj.url];
    mf.formatId = urlObj.type || 'media';
    if (urlObj.ext === 'mp4') {
      mf.type = MediaType.Video;
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.thumbnailUrl = obj.thumb ? [obj.thumb] : [];
    } else {
      mf.type = MediaType.Photo;
    }
    item.addFormats(mf);
  }

  return media.items.length ? media : null;
}

async function getIGramStory(ctx) {
  const apiUrl = `https://${igramHostname}/api/v1/instagram/story`;
  const resp = await ctx.fetch('POST', apiUrl, {
    body: JSON.stringify({ url: ctx.contentUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`igram story failed: ${resp.status}`);

  const data = resp.data;
  if (!data?.result?.length) throw Errors.Unavailable;

  const result = data.result[0];
  const media = ctx.newMedia();
  const item = media.newItem();

  if (result.video_versions?.length) {
    const video = result.video_versions[0];
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = 'video';
    mf.url = [video.url];
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    item.addFormats(mf);
  } else {
    const image = result.image_versions?.candidates?.[0];
    if (!image) throw Errors.Unavailable;
    const mf = new MediaFormat();
    mf.type = MediaType.Photo;
    mf.formatId = 'photo';
    mf.url = [image.url];
    item.addFormats(mf);
  }

  return media;
}
