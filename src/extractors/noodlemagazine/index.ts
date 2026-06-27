import { Extractor, MediaFormat, DownloadSettings, Media, ExtractorContext } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';
import { Errors } from '../../util/index.js';
import logger from '../../logger/index.js';

const QUALITIES: { label: string; height: number }[] = [
  { label: 'vid_1080p', height: 1080 },
  { label: 'vid_720p', height: 720 },
  { label: 'vid_480p', height: 480 },
  { label: 'vid_360p', height: 360 },
  { label: 'vid_240p', height: 240 },
];

const downloadHeaders = { Referer: 'https://noodlemagazine.com/' };
const fetchHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const NoodleMagazineExtractor = new Extractor({
  id: 'noodlemagazine',
  displayName: 'NoodleMagazine',
  urlPattern: /https?:\/\/(www\.)?noodlemagazine\.com\/watch\/(?<id>-?\d+_\d+)/,
  host: ['noodlemagazine'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  const watchUrl = `https://noodlemagazine.com/watch/${ctx.contentId}`;
  const resp = await fetch(watchUrl, { headers: fetchHeaders });
  if (!resp.ok) {
    logger.warn({ status: resp.status, id: ctx.contentId }, 'noodlemagazine: watch page failed');
    throw Errors.Unavailable;
  }

  const html = await resp.text();

  const title = extractTitle(html);
  const formats = extractFormats(html);

  if (!formats.length) {
    logger.warn({ id: ctx.contentId, snippet: html.slice(0, 200) }, 'noodlemagazine: no formats found');
    throw Errors.Unavailable;
  }

  const media = ctx.newMedia();
  media.setCaption(title);
  media.setNSFW();

  const item = media.newItem();

  for (const { url, height } of formats) {
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = `vid_${height}p`;
    mf.url = [url];
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.height = height;
    mf.width = Math.round(height * 16 / 9);
    mf.downloadSettings = new DownloadSettings({ headers: downloadHeaders });
    item.addFormats(mf);
  }

  logger.debug({ id: ctx.contentId, formats: formats.length }, 'noodlemagazine: resolved');
  return media;
}

function extractTitle(html: string): string {
  const og = html.match(/"og:title" content="([^"]+)"/);
  if (og) return og[1];
  const title = html.match(/<title>([^<]+)<\/title>/);
  if (title) return title[1].replace(/ watch online$/, '').trim();
  return '';
}

function extractFormats(html: string): { url: string; height: number }[] {
  const results: { url: string; height: number }[] = [];
  for (const { label, height } of QUALITIES) {
    // Match "file":"https://cdn.../{label}.mp4?secure=..."
    const re = new RegExp('"file":"(https://cdn[^"]*/' + label + '\\.mp4[^"]*)"');
    const m = html.match(re);
    if (m) results.push({ url: m[1].replace(/\\u0026/g, '&'), height });
  }
  return results;
}
