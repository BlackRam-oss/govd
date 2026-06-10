import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Env } from '../config/index.js';
import logger from '../logger/index.js';

const DEFAULT_TIMEOUT = 30_000;

export class HTTPClient {
  constructor({ proxy, downloadProxy, edgeProxy, disableProxy, cookies, headers, impersonate } = {}) {
    this.proxy = proxy || '';
    this.downloadProxy = downloadProxy || '';
    this.edgeProxy = edgeProxy || '';
    this.disableProxy = disableProxy || false;
    this.cookies = cookies || null;
    this.headers = headers || {};
    this.impersonate = impersonate || false;

    this._axios = this._buildAxios(proxy || Env.Proxy);
  }

  _buildAxios(proxyUrl) {
    const jar = new CookieJar();
    const instance = wrapper(axios.create({ timeout: DEFAULT_TIMEOUT, jar }));

    if (proxyUrl) {
      try {
        const agent = proxyUrl.startsWith('socks')
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl);
        instance.defaults.httpAgent = agent;
        instance.defaults.httpsAgent = agent;
      } catch (e) {
        logger.warn({ err: e.message }, 'invalid proxy URL');
      }
    }

    // Set default headers
    instance.defaults.headers.common['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

    // Pre-populate cookies into the jar
    if (this.cookies) {
      for (const c of this.cookies) {
        jar.setCookieSync(`${c.name}=${c.value}`, 'https://example.com');
      }
    }

    return instance;
  }

  async fetch(method, url, { body, headers, cookies, responseType } = {}) {
    const mergedHeaders = { ...this.headers, ...headers };

    if (cookies) {
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      mergedHeaders['Cookie'] = cookieHeader;
    }

    const response = await this._axios.request({
      method,
      url,
      data: body,
      headers: mergedHeaders,
      responseType: responseType || 'json',
      maxRedirects: 10,
      validateStatus: () => true,
    });

    return response;
  }

  async fetchText(method, url, params = {}) {
    return this.fetch(method, url, { ...params, responseType: 'text' });
  }

  async fetchBuffer(method, url, params = {}) {
    return this.fetch(method, url, { ...params, responseType: 'arraybuffer' });
  }

  async fetchStream(method, url, params = {}) {
    return this.fetch(method, url, { ...params, responseType: 'stream' });
  }

  asDownloadClient() {
    return new HTTPClient({
      proxy: this.downloadProxy || (this.disableProxy ? '' : this.proxy),
      headers: this.headers,
      cookies: this.cookies,
      disableProxy: this.disableProxy,
    });
  }
}

export function newHTTPClient(options = {}) {
  return new HTTPClient(options);
}
