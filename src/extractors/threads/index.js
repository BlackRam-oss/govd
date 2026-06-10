import { Extractor, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';

export const ThreadsExtractor = new Extractor({
  id: 'threads',
  displayName: 'Threads',
  urlPattern: /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@?[^/]+\/post\/(?<id>[a-zA-Z0-9_-]+)/,
  host: ['threads'],
  async getFunc(ctx) {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx) {
  const postId = ctx.contentId;

  const resp = await ctx.fetch('GET', ctx.contentUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    responseType: 'text',
  });

  if (resp.status !== 200) throw new Error(`threads fetch failed: ${resp.status}`);

  const html = resp.data;
  const lsdMatch = html.match(/"lsd":"([^"]+)"/);
  const lsd = lsdMatch?.[1] || '';

  const variables = JSON.stringify({
    postID: postId,
  });

  const apiResp = await ctx.fetch('POST', 'https://www.threads.net/api/graphql', {
    body: new URLSearchParams({
      lsd,
      variables,
      doc_id: '6232751443445612',
    }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-IG-App-ID': '238260118697367',
      'X-FB-LSD': lsd,
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (apiResp.status !== 200) throw new Error(`threads api failed: ${apiResp.status}`);

  const data = apiResp.data;
  const thread = data?.data?.data?.edges?.[0]?.node?.thread_items?.[0]?.post;
  if (!thread) throw new Error('no threads data');

  const media = ctx.newMedia();
  const caption = thread.caption?.text || '';
  media.setCaption(caption);

  const candidates = thread.carousel_media || [thread];

  for (const node of candidates) {
    const item = media.newItem();

    if (node.video_versions?.length) {
      const video = node.video_versions[0];
      const mf = new MediaFormat();
      mf.type = MediaType.Video;
      mf.formatId = 'video';
      mf.url = [video.url];
      mf.videoCodec = MediaCodec.Avc;
      mf.audioCodec = MediaCodec.Aac;
      mf.width = video.width || 0;
      mf.height = video.height || 0;
      item.addFormats(mf);
    } else if (node.image_versions2?.candidates?.length) {
      const img = node.image_versions2.candidates[0];
      const mf = new MediaFormat();
      mf.type = MediaType.Photo;
      mf.formatId = 'photo';
      mf.url = [img.url];
      item.addFormats(mf);
    }
  }

  return media.items.length ? media : null;
}
