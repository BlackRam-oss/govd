/**
 * In-memory store - sostituisce PostgreSQL.
 * Quando DB_HOST/PORT/ecc. sono impostati vengono letti ma non usati:
 * tutte le operazioni avvengono su Map/variabili in-memory.
 */

import { Env } from '../config/index.js';
import logger from '../logger/index.js';

// ── tipi (equivalenti degli enum Go) ─────────────────────────────────────────

export const ChatType = { Private: 'private', Group: 'group' };

export const MediaType = { Photo: 'photo', Video: 'video', Audio: 'audio' };

export const MediaCodec = {
  Avc: 'avc', Hevc: 'hevc', Vp9: 'vp9', Vp8: 'vp8',
  Av1: 'av1', Webp: 'webp', Aac: 'aac', Opus: 'opus',
  Vorbis: 'vorbis', Mp3: 'mp3', Flac: 'flac',
};

// ── store ─────────────────────────────────────────────────────────────────────

const chatStore = new Map();   // chatId (number) → ChatRow
const mediaStore = new Map();  // `${extractorId}:${contentId}` → MediaEntry
const errorStore = new Map();  // errorId → { message, occurrences, firstSeen, lastSeen }

const stats = {
  totalPrivateChats: 0,
  totalGroupChats: 0,
  totalDownloads: 0,
  totalDownloadsSize: 0,
  privateChatsByLanguage: {},
  groupChatsByLanguage: {},
};

let mediaIdCounter = 1;
let itemIdCounter = 1;

// ── helpers ───────────────────────────────────────────────────────────────────

function defaultSettings(chatId, type, language, captions, silent, nsfw, mediaAlbumLimit, deleteLinks) {
  return {
    chatId,
    type,
    nsfw,
    mediaAlbumLimit,
    captions,
    silent,
    language,
    disabledExtractors: [],
    deleteLinks,
  };
}

function chatKey(chatId) { return String(chatId); }

function mediaKey(extractorId, contentId) { return `${extractorId}:${contentId}`; }

// ── funzioni database ─────────────────────────────────────────────────────────

export function getOrCreateChat(chatId, type, language, captions, silent, nsfw, mediaAlbumLimit, deleteLinks) {
  const key = chatKey(chatId);
  if (chatStore.has(key)) {
    const existing = chatStore.get(key);
    // aggiorna lingua se era 'XX' (auto-detect)
    if (existing.language === 'XX') {
      existing.language = language;
      chatStore.set(key, existing);
    }
    return existing;
  }

  const row = defaultSettings(chatId, type, language, captions, silent, nsfw, mediaAlbumLimit, deleteLinks);
  chatStore.set(key, row);

  if (type === ChatType.Private) {
    stats.totalPrivateChats++;
    stats.privateChatsByLanguage[language] = (stats.privateChatsByLanguage[language] || 0) + 1;
  } else {
    stats.totalGroupChats++;
    stats.groupChatsByLanguage[language] = (stats.groupChatsByLanguage[language] || 0) + 1;
  }

  logger.debug({ chatId, type }, 'chat created in memory');
  return row;
}

export function getMediaByContentID(contentId, extractorId) {
  const entry = mediaStore.get(mediaKey(extractorId, contentId));
  if (!entry) return null;
  return {
    id: entry.id,
    contentId: entry.contentId,
    contentUrl: entry.contentUrl,
    extractorId: entry.extractorId,
    caption: entry.caption,
    nsfw: entry.nsfw,
  };
}

export function createMedia(extractorId, contentUrl, contentId, caption, nsfw) {
  const key = mediaKey(extractorId, contentId);
  if (mediaStore.has(key)) {
    logger.debug({ contentId }, 'media already exists in memory');
    return mediaStore.get(key).id;
  }
  const id = mediaIdCounter++;
  mediaStore.set(key, {
    id,
    contentId,
    contentUrl,
    extractorId,
    caption: caption || '',
    nsfw: nsfw || false,
    items: [],
    createdAt: new Date(),
  });
  return id;
}

export function createMediaItem(mediaId) {
  const id = itemIdCounter++;
  for (const entry of mediaStore.values()) {
    if (entry.id === mediaId) {
      entry.items.push({ id, formats: [] });
      break;
    }
  }
  return id;
}

export function createMediaFormat(itemId, formatId, fileId, type, audioCodec, videoCodec, duration, fileSize, title, artist, width, height, bitrate) {
  for (const entry of mediaStore.values()) {
    for (const item of entry.items) {
      if (item.id === itemId) {
        item.formats.push({ formatId, fileId, type, audioCodec, videoCodec, duration, fileSize, title, artist, width, height, bitrate });
        stats.totalDownloads++;
        if (fileSize) stats.totalDownloadsSize += fileSize;
        return;
      }
    }
  }
}

export function getMediaItems(mediaId) {
  for (const entry of mediaStore.values()) {
    if (entry.id === mediaId) {
      return entry.items.map(i => ({ id: i.id, mediaId }));
    }
  }
  return [];
}

export function getMediaFormat(itemId) {
  for (const entry of mediaStore.values()) {
    for (const item of entry.items) {
      if (item.id === itemId && item.formats.length > 0) {
        return item.formats[0];
      }
    }
  }
  return null;
}

// ── settings ──────────────────────────────────────────────────────────────────

function getChat(chatId) {
  return chatStore.get(chatKey(chatId));
}

export function toggleChatCaptions(chatId) {
  const c = getChat(chatId);
  if (c) { c.captions = !c.captions; }
}

export function toggleChatNsfw(chatId) {
  const c = getChat(chatId);
  if (c) { c.nsfw = !c.nsfw; }
}

export function toggleChatSilentMode(chatId) {
  const c = getChat(chatId);
  if (c) { c.silent = !c.silent; }
}

export function toggleChatDeleteLinks(chatId) {
  const c = getChat(chatId);
  if (c) { c.deleteLinks = !c.deleteLinks; }
}

export function setChatLanguage(chatId, language) {
  const c = getChat(chatId);
  if (c) { c.language = language; }
}

export function setChatMediaAlbumLimit(chatId, limit) {
  const c = getChat(chatId);
  if (c) { c.mediaAlbumLimit = limit; }
}

export function addDisabledExtractor(chatId, extractorId) {
  const c = getChat(chatId);
  if (c && !c.disabledExtractors.includes(extractorId)) {
    c.disabledExtractors.push(extractorId);
  }
}

export function removeDisabledExtractor(chatId, extractorId) {
  const c = getChat(chatId);
  if (c) {
    c.disabledExtractors = c.disabledExtractors.filter(e => e !== extractorId);
  }
}

// ── stats ─────────────────────────────────────────────────────────────────────

export function getStats(sinceDate) {
  return { ...stats };
}

// ── error log ─────────────────────────────────────────────────────────────────

export function logError(id, message) {
  if (errorStore.has(id)) {
    const e = errorStore.get(id);
    e.occurrences++;
    e.lastSeen = new Date();
  } else {
    errorStore.set(id, { message, occurrences: 1, firstSeen: new Date(), lastSeen: new Date() });
  }
}

// ── init ──────────────────────────────────────────────────────────────────────

export function init() {
  const hasDbConfig = Env.DBHost && Env.DBName && Env.DBUser;
  if (hasDbConfig) {
    logger.info('DB vars rilevate ma non usate: storage in-memory attivo');
  } else {
    logger.info('storage in-memory attivo (nessun DB configurato)');
  }
}

export default {
  init,
  getOrCreateChat,
  getMediaByContentID,
  createMedia,
  createMediaItem,
  createMediaFormat,
  getMediaItems,
  getMediaFormat,
  toggleChatCaptions,
  toggleChatNsfw,
  toggleChatSilentMode,
  toggleChatDeleteLinks,
  setChatLanguage,
  setChatMediaAlbumLimit,
  addDisabledExtractor,
  removeDisabledExtractor,
  getStats,
  logError,
  ChatType,
  MediaType,
  MediaCodec,
};
