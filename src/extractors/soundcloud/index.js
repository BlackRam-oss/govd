import { Extractor, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import logger from '../../logger/index.js';

const CLIENT_ID = 'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX';

export const SoundCloudShortExtractor = new Extractor({
  id: 'soundcloud',
  displayName: 'SoundCloud (Short)',
  urlPattern: /https?:\/\/on\.soundcloud\.com\/(?<id>[a-zA-Z0-9]+)/,
  host: ['on'],
  redirect: true,
  async getFunc(ctx) {
    const resp = await ctx.fetch('GET', ctx.contentUrl);
    const finalUrl = resp.request?.res?.responseUrl || ctx.contentUrl;
    return { url: finalUrl };
  },
});

export const SoundCloudExtractor = new Extractor({
  id: 'soundcloud',
  displayName: 'SoundCloud',
  urlPattern: /https?:\/\/(?:(?:www|m)\.)?soundcloud\.com\/(?<id>[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/,
  host: ['soundcloud'],
  async getFunc(ctx) {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx) {
  const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(ctx.contentUrl)}&client_id=${CLIENT_ID}`;

  const resp = await ctx.fetch('GET', resolveUrl);
  if (resp.status !== 200) throw new Error(`soundcloud resolve failed: ${resp.status}`);

  const track = resp.data;
  if (!track || track.kind !== 'track') throw new Error('not a soundcloud track');

  const media = ctx.newMedia();
  media.setCaption(track.title);

  const transcodings = track.media?.transcodings || [];
  const progressive = transcodings.find(t => t.format?.protocol === 'progressive');
  const hls = transcodings.find(t => t.format?.protocol === 'hls');
  const chosen = progressive || hls;

  if (!chosen) throw new Error('no soundcloud format found');

  const streamUrl = `${chosen.url}?client_id=${CLIENT_ID}`;
  const streamResp = await ctx.fetch('GET', streamUrl);
  if (streamResp.status !== 200) throw new Error(`soundcloud stream failed: ${streamResp.status}`);

  const mp3Url = streamResp.data?.url;
  if (!mp3Url) throw new Error('no soundcloud stream URL');

  const item = media.newItem();
  const mf = new MediaFormat();
  mf.type = MediaType.Audio;
  mf.formatId = 'audio';
  mf.audioCodec = MediaCodec.Mp3;
  mf.url = [mp3Url];
  mf.title = track.title || '';
  mf.artist = track.user?.username || '';
  mf.duration = Math.round((track.duration || 0) / 1000);
  mf.thumbnailUrl = track.artwork_url ? [track.artwork_url.replace('-large', '-t500x500')] : [];
  item.addFormats(mf);

  return media;
}
