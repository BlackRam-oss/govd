import * as db from '../database/index.js';
import { Media, MediaItem, MediaFormat } from '../models/index.js';
import { getMessageFileId, getMessageFileSize } from '../util/index.js';
import logger from '../logger/index.js';

export async function storeMedia(extractor, media, messages, formats) {
  if (!media.items.length) throw new Error('no item to store');

  const fileIds = messages.map(getMessageFileId);
  const fileSizes = messages.map(getMessageFileSize);

  if (fileIds.length !== media.items.length) {
    throw new Error('number of file IDs does not match number of media items');
  }

  const mediaId = db.createMedia(
    extractor.id,
    media.contentUrl,
    media.contentId,
    media.caption,
    media.nsfw,
  );

  for (let i = 0; i < media.items.length; i++) {
    const itemId = db.createMediaItem(mediaId);
    const fileId = fileIds[i];
    const fileSize = fileSizes[i];
    const format = formats[i].format;

    db.createMediaFormat(
      itemId,
      format.formatId,
      fileId,
      format.type,
      format.audioCodec,
      format.videoCodec,
      format.duration,
      fileSize || format.fileSize,
      format.title,
      format.artist,
      format.width,
      format.height,
      format.bitrate,
    );
  }

  logger.debug({ contentId: media.contentId, items: media.items.length }, 'stored media in memory');
}

export function parseStoredMedia(extractor, mediaRow) {
  const itemRows = db.getMediaItems(mediaRow.id);
  if (!itemRows.length) throw new Error('no media items found');

  const items = itemRows.map(row => {
    const fmt = db.getMediaFormat(row.id);
    const item = new MediaItem();
    if (fmt) {
      const mf = new MediaFormat();
      Object.assign(mf, fmt);
      item.formats = [mf];
    }
    return item;
  });

  const media = new Media();
  media.contentId = mediaRow.contentId;
  media.contentUrl = mediaRow.contentUrl;
  media.caption = mediaRow.caption || '';
  media.nsfw = mediaRow.nsfw;
  media.extractorId = extractor.id;
  media.items = items;

  return media;
}
