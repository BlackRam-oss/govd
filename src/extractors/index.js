import { ExtractorContext } from '../models/index.js';
import { getExtractorConfig } from '../config/index.js';
import { newHTTPClient } from '../networking/index.js';
import { extractBaseHost, getNamedGroups } from '../util/index.js';
import logger from '../logger/index.js';

import { YouTubeExtractor } from './youtube/index.js';
import { TwitterExtractor, TwitterShortExtractor } from './twitter/index.js';
import { TikTokExtractor, TikTokVMExtractor } from './tiktok/index.js';
import { InstagramExtractor, InstagramStoriesExtractor, InstagramShareExtractor } from './instagram/index.js';
import { FacebookExtractor, FacebookShareExtractor } from './facebook/index.js';
import { RedditExtractor, RedditShortExtractor } from './reddit/index.js';
import { PinterestExtractor, PinterestShortExtractor } from './pinterest/index.js';
import { SoundCloudExtractor, SoundCloudShortExtractor } from './soundcloud/index.js';
import { NineGagExtractor } from './ninegag/index.js';
import { ThreadsExtractor } from './threads/index.js';

export const Extractors = [
  FacebookShareExtractor,
  FacebookExtractor,
  TikTokVMExtractor,
  TikTokExtractor,
  SoundCloudShortExtractor,
  SoundCloudExtractor,
  TwitterShortExtractor,
  TwitterExtractor,
  InstagramExtractor,
  InstagramStoriesExtractor,
  InstagramShareExtractor,
  NineGagExtractor,
  YouTubeExtractor,
  PinterestShortExtractor,
  PinterestExtractor,
  RedditExtractor,
  RedditShortExtractor,
  ThreadsExtractor,
];

const MAX_REDIRECTS = 5;

const extractorsByHost = buildExtractorsMap();

function buildExtractorsMap() {
  const map = new Map();
  for (const extractor of Extractors) {
    for (const host of (extractor.host || [])) {
      if (!map.has(host)) map.set(host, []);
      map.get(host).push(extractor);
    }
  }
  return map;
}

export function fromURL(url) {
  let currentURL = url;
  let redirectCount = 0;

  const abortController = new AbortController();

  const loop = async () => {
    while (redirectCount <= MAX_REDIRECTS) {
      const host = extractBaseHost(currentURL);
      if (!host) return null;

      const candidates = extractorsByHost.get(host) || [];
      if (!candidates.length) return null;

      let extractor = null;
      let groups = null;

      for (const e of candidates) {
        const match = currentURL.match(e.urlPattern);
        if (match) {
          extractor = e;
          groups = { ...match.groups, match: match[0] };
          break;
        }
      }

      if (!extractor) {
        logger.debug(`no extractor matched for URL: ${currentURL}`);
        return null;
      }

      const cfg = getExtractorConfig(extractor.id);
      if (cfg.isDisabled) {
        logger.debug(`[${extractor.id}] extractor is disabled`);
        return null;
      }

      for (const r of (cfg.ignoreRegex || [])) {
        if (r.test(currentURL)) {
          logger.debug(`[${extractor.id}] URL matches ignore_regex, skipping`);
          return null;
        }
      }

      const ctx = new ExtractorContext({
        contentId: groups?.id || '',
        contentUrl: groups?.match || currentURL,
        matchGroups: groups || {},
        extractor,
        config: cfg,
        httpClient: newHTTPClient({
          proxy: cfg.proxy,
          downloadProxy: cfg.downloadProxy,
          edgeProxy: cfg.edgeProxy,
          disableProxy: cfg.disableProxy,
          impersonate: cfg.impersonate,
        }),
      });

      if (!extractor.redirect) {
        return ctx;
      }

      ctx.debug('following redirect');
      try {
        const response = await extractor.getFunc(ctx);
        if (!response?.url) {
          ctx.debug('no suitable redirect URL');
          return null;
        }
        ctx.debug(`redirected to ${response.url}`);
        currentURL = response.url;
        redirectCount++;
      } catch (e) {
        ctx.error(`redirect failed: ${e.message}`);
        return null;
      }
    }

    logger.error(`exceeded maximum redirects for URL: ${url}`);
    return null;
  };

  return { loop, abortController };
}

export async function resolveURL(url) {
  const { loop } = fromURL(url);
  return loop();
}
