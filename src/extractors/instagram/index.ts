import { Extractor, MediaFormat, ExtractorContext, Media } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

const instagramHost: string[] = ['instagram', 'ddinstagram'];
const igramHostname: string = 'igram.world';

const webHeaders: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

export const InstagramExtractor = new Extractor({
  id: 'instagram',
  displayName: 'Instagram',
  urlPattern: /https:\/\/(www\.)?(?:dd)?instagram\.com\/(reels?|p|tv)\/(?<id>[a-zA-Z0-9_-]+)/,
  host: instagramHost,
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    let media: Media | null | undefined, err: unknown;

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
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
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
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const resp = await ctx.fetch('GET', ctx.contentUrl, { headers: webHeaders });
    const redirectUrl: string = resp.request?.res?.responseUrl || ctx.contentUrl;
    return { url: redirectUrl };
  },
});

async function getGQLMedia(ctx: ExtractorContext): Promise<Media | null> {
  const url = `https://www.instagram.com/graphql/query/?query_hash=9f8827793ef34641b2fb195d4d41151c&variables={"shortcode":"${ctx.contentId}"}`;
  const resp = await ctx.fetch('GET', url, {
    headers: {
      ...webHeaders,
      'X-IG-App-ID': '936619743392459',
    },
  });
  if (resp.status !== 200) throw new Error(`GQL failed: ${resp.status}`);
  const shortcodeMedia: unknown = resp.data?.data?.shortcode_media;
  if (!shortcodeMedia) throw new Error('no GQL data');
  return parseGQLMedia(ctx, shortcodeMedia);
}

async function getEmbedMedia(ctx: ExtractorContext): Promise<Media | null> {
  const url = `https://www.instagram.com/p/${ctx.contentId}/embed/captioned`;
  const resp = await ctx.fetch('GET', url, {
    headers: webHeaders,
    responseType: 'text',
  });
  if (resp.status !== 200) throw new Error(`embed failed: ${resp.status}`);
  const html: string = resp.data;
  const match = html.match(/window\.__additionalDataLoaded\('extra',(\{.*?\})\);/s) ||
                html.match(/PolarisPostRootPageQueryRelayPreloader.*?"data":(\{.*?\})/s);
  if (!match) throw new Error('embed data not found');
  try {
    const data: Record<string, unknown> = JSON.parse(match[1]);
    const shortcodeMedia: unknown = (data?.shortcode_media) || ((data?.data as Record<string, unknown>)?.shortcode_media);
    if (!shortcodeMedia) throw new Error('no embed media');
    return parseGQLMedia(ctx, shortcodeMedia);
  } catch (e) {
    throw new Error(`embed parse failed: ${(e as Error).message}`);
  }
}

function parseGQLMedia(ctx: ExtractorContext, data: unknown): Media | null {
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const media = ctx.newMedia();
  const caption: string = ((d.edge_media_to_caption as Record<string, unknown>)?.edges as Array<Record<string, unknown>>)?.[0]?.node
    ? (((d.edge_media_to_caption as Record<string, unknown>)?.edges as Array<Record<string, unknown>>)[0].node as Record<string, unknown>).text as string
    : '';
  media.setCaption(caption || '');

  const nodes: unknown[] = d.__typename === 'GraphSidecar'
    ? ((d.edge_sidecar_to_children as Record<string, unknown>)?.edges as Array<Record<string, unknown>> || []).map((e) => e.node)
    : [d];

  for (const nodeRaw of nodes) {
    const node = nodeRaw as Record<string, unknown>;
    const item = media.newItem();
    if (node.is_video) {
      const mf = new MediaFormat();
      mf.type = MediaType.Video;
      mf.formatId = 'video';
      mf.url = [node.video_url as string];
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.width = (node.dimensions as Record<string, number>)?.width || 0;
      mf.height = (node.dimensions as Record<string, number>)?.height || 0;
      mf.thumbnailUrl = node.thumbnail_src ? [node.thumbnail_src as string] : [];
      item.addFormats(mf);
    } else {
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
      mf.url = [node.display_url as string];
      item.addFormats(mf);
    }
  }

  return media.items.length ? media : null;
}

async function getIGramPost(ctx: ExtractorContext): Promise<Media | null> {
  const contentUrl = `https://www.instagram.com/p/${ctx.contentId}/`;
  const apiUrl = `https://${igramHostname}/api/convert`;

  const resp = await ctx.fetch('POST', apiUrl, {
    body: JSON.stringify({ url: contentUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`igram failed: ${resp.status}`);

  const data = resp.data as Record<string, unknown>;
  if (!(data?.items as unknown[])?.length) throw new Error('no igram items');

  const media = ctx.newMedia();
  for (const obj of data.items as Array<Record<string, unknown>>) {
    const item = media.newItem();
    const urlArr = obj.url as Array<Record<string, unknown>>;
    if (!urlArr?.[0]?.url) throw new Error('no igram url');
    const urlObj = urlArr[0];
    const mf = new MediaFormat();
    mf.url = [urlObj.url as string];
    mf.formatId = (urlObj.type as string) || 'media';
    if (urlObj.ext === 'mp4') {
      mf.type = MediaType.Video;
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.thumbnailUrl = obj.thumb ? [obj.thumb as string] : [];
    } else {
      mf.type = MediaType.Photo;
    }
    item.addFormats(mf);
  }

  return media.items.length ? media : null;
}

async function getIGramStory(ctx: ExtractorContext): Promise<Media> {
  const apiUrl = `https://${igramHostname}/api/v1/instagram/story`;
  const resp = await ctx.fetch('POST', apiUrl, {
    body: JSON.stringify({ url: ctx.contentUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`igram story failed: ${resp.status}`);

  const data = resp.data as Record<string, unknown>;
  if (!(data?.result as unknown[])?.length) throw Errors.Unavailable;

  const result = (data.result as Array<Record<string, unknown>>)[0];
  const media = ctx.newMedia();
  const item = media.newItem();

  const videoVersions = result.video_versions as Array<Record<string, unknown>> | undefined;
  if (videoVersions?.length) {
    const video = videoVersions[0];
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = 'video';
    mf.url = [video.url as string];
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    item.addFormats(mf);
  } else {
    const imageVersions = result.image_versions as Record<string, unknown> | undefined;
    const image = (imageVersions?.candidates as Array<Record<string, unknown>>)?.[0];
    if (!image) throw Errors.Unavailable;
    const mf = new MediaFormat();
    mf.type = MediaType.Photo;
    mf.formatId = 'photo';
    mf.url = [image.url as string];
    item.addFormats(mf);
  }

  return media;
}
