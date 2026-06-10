import { Extractor, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';

export const PinterestShortExtractor = new Extractor({
  id: 'pinterest',
  displayName: 'Pinterest (Short)',
  urlPattern: /https?:\/\/pin\.it\/(?<id>[a-zA-Z0-9]+)/,
  host: ['pin'],
  redirect: true,
  async getFunc(ctx) {
    const resp = await ctx.fetch('GET', ctx.contentUrl);
    const finalUrl = resp.request?.res?.responseUrl || ctx.contentUrl;
    return { url: finalUrl };
  },
});

export const PinterestExtractor = new Extractor({
  id: 'pinterest',
  displayName: 'Pinterest',
  urlPattern: /https?:\/\/(?:[a-z]{2}\.)?(?:www\.)?pinterest\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)\/pin\/(?<id>\d+)/,
  host: ['pinterest'],
  async getFunc(ctx) {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx) {
  const pinId = ctx.contentId;
  const url = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data={"options":{"id":"${pinId}","field_set_key":"unauth_react_main_pin"}}&_=1`;

  const resp = await ctx.fetch('GET', url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (resp.status !== 200) throw new Error(`pinterest API failed: ${resp.status}`);

  const pin = resp.data?.resource_response?.data;
  if (!pin) throw new Error('no pin data');

  const media = ctx.newMedia();
  media.setCaption(pin.description || pin.title || '');

  const item = media.newItem();

  const video = pin.videos?.video_list;
  if (video && Object.keys(video).length) {
    const best = Object.values(video).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = 'video';
    mf.url = [best.url];
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = best.width || 0;
    mf.height = best.height || 0;
    item.addFormats(mf);
    return media;
  }

  const imageUrl = pin.images?.orig?.url || pin.images?.['736x']?.url;
  if (imageUrl) {
    const mf = new MediaFormat();
    mf.type = MediaType.Photo;
    mf.formatId = 'photo';
    mf.url = [imageUrl];
    item.addFormats(mf);
    return media;
  }

  throw new Error('no pinterest media found');
}
