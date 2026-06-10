import { Extractor, ExtractorContext, Media, MediaFormat } from '../../models/index.js';
import { MediaType, MediaCodec } from '../../database/index.js';

export const NineGagExtractor = new Extractor({
  id: '9gag',
  displayName: '9GAG',
  urlPattern: /https?:\/\/9gag\.com\/gag\/(?<id>[a-zA-Z0-9]+)/,
  host: ['9gag'],
  async getFunc(ctx: ExtractorContext): Promise<{ media?: Media; url?: string }> {
    const media = await getMedia(ctx);
    return { media };
  },
});

async function getMedia(ctx: ExtractorContext): Promise<Media> {
  const url = `https://9gag.com/v1/post-view?postId=${ctx.contentId}`;
  const resp = await ctx.fetch('GET', url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (resp.status !== 200) throw new Error(`9gag api failed: ${resp.status}`);
  const post = resp.data?.data?.post;
  if (!post) throw new Error('no 9gag post data');

  const media = ctx.newMedia();
  if (post.nsfw) media.setNSFW();
  media.setCaption(post.title || '');

  const images = post.images;
  if (!images) throw new Error('no 9gag images');

  const item = media.newItem();

  if (images.image460sv?.url || images.image460svwm?.url) {
    const videoUrl: string = images.image460sv?.url || images.image460svwm?.url;
    const mf = new MediaFormat();
    mf.type = MediaType.Video;
    mf.formatId = 'video';
    mf.url = [videoUrl];
    mf.videoCodec = MediaCodec.Avc;
    mf.audioCodec = MediaCodec.Aac;
    mf.width = images.image460sv?.width || 0;
    mf.height = images.image460sv?.height || 0;
    item.addFormats(mf);
  } else {
    const imageUrl: string | undefined = images.image700?.url || images.image460?.url;
    if (!imageUrl) throw new Error('no 9gag image URL');
    const mf = new MediaFormat();
    mf.type = MediaType.Photo;
    mf.formatId = 'photo';
    mf.url = [imageUrl];
    item.addFormats(mf);
  }

  return media;
}
