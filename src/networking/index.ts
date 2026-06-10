import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Env } from '../config/index.js';
import logger from '../logger/index.js';

const DEFAULT_TIMEOUT = 30_000;

export interface Cookie {
  name: string;
  value: string;
}

export interface FetchParams {
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: Cookie[];
  responseType?: string;
}

interface HTTPClientOptions {
  proxy?: string;
  downloadProxy?: string;
  edgeProxy?: string;
  disableProxy?: boolean;
  cookies?: Cookie[] | null;
  headers?: Record<string, string>;
  impersonate?: boolean;
}

export class HTTPClient {
  proxy: string;
  downloadProxy: string;
  edgeProxy: string;
  disableProxy: boolean;
  cookies: Cookie[] | null;
  headers: Record<string, string>;
  impersonate: boolean;
  _axios: AxiosInstance;

  constructor({
    proxy,
    downloadProxy,
    edgeProxy,
    disableProxy,
    cookies,
    headers,
    impersonate,
  }: HTTPClientOptions = {}) {
    this.proxy = proxy || '';
    this.downloadProxy = downloadProxy || '';
    this.edgeProxy = edgeProxy || '';
    this.disableProxy = disableProxy || false;
    this.cookies = cookies || null;
    this.headers = headers || {};
    this.impersonate = impersonate || false;

    this._axios = this._buildAxios(proxy || Env.Proxy);
  }

  _buildAxios(proxyUrl: string): AxiosInstance {
    const jar = new CookieJar();
    const instance = wrapper(axios.create({ timeout: DEFAULT_TIMEOUT, jar } as any));

    if (proxyUrl) {
      try {
        const agent = proxyUrl.startsWith('socks')
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl);
        instance.defaults.httpAgent = agent;
        instance.defaults.httpsAgent = agent;
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'invalid proxy URL');
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

  async fetch(
    method: string,
    url: string,
    { body, headers, cookies, responseType }: FetchParams = {},
  ): Promise<AxiosResponse> {
    const mergedHeaders: Record<string, string> = { ...this.headers, ...headers };

    if (cookies) {
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      mergedHeaders['Cookie'] = cookieHeader;
    }

    const response = await this._axios.request({
      method,
      url,
      data: body,
      headers: mergedHeaders,
      responseType: (responseType || 'json') as any,
      maxRedirects: 10,
      validateStatus: () => true,
    });

    return response;
  }

  async fetchText(method: string, url: string, params: FetchParams = {}): Promise<AxiosResponse> {
    return this.fetch(method, url, { ...params, responseType: 'text' });
  }

  async fetchBuffer(method: string, url: string, params: FetchParams = {}): Promise<AxiosResponse> {
    return this.fetch(method, url, { ...params, responseType: 'arraybuffer' });
  }

  async fetchStream(method: string, url: string, params: FetchParams = {}): Promise<AxiosResponse> {
    return this.fetch(method, url, { ...params, responseType: 'stream' });
  }

  asDownloadClient(): HTTPClient {
    return new HTTPClient({
      proxy: this.downloadProxy || (this.disableProxy ? '' : this.proxy),
      headers: this.headers,
      cookies: this.cookies,
      disableProxy: this.disableProxy,
    });
  }
}

export function newHTTPClient(options: HTTPClientOptions = {}): HTTPClient {
  return new HTTPClient(options);
}
