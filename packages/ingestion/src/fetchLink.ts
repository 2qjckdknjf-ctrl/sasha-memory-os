import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { URL } from 'node:url';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt('0.0.0.0'), ipv4ToInt('0.255.255.255')],
    [ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')],
    [ipv4ToInt('127.0.0.0'), ipv4ToInt('127.255.255.255')],
    [ipv4ToInt('169.254.0.0'), ipv4ToInt('169.254.255.255')],
    [ipv4ToInt('172.16.0.0'), ipv4ToInt('172.31.255.255')],
    [ipv4ToInt('192.168.0.0'), ipv4ToInt('192.168.255.255')],
  ];
  return ranges.some(([start, end]) => n >= start && n <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http/https urls are allowed');
  }
  if (url.username || url.password) {
    throw new Error('urls with credentials are blocked');
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('blocked host');
  }

  const addresses =
    isIP(host) > 0
      ? [host]
      : (await lookup(host, { all: true })).map((row) => row.address);

  if (addresses.length === 0) {
    throw new Error('host did not resolve');
  }

  for (const address of addresses) {
    const version = isIP(address);
    if (version === 4 && isPrivateIpv4(address)) {
      throw new Error(`blocked private address: ${address}`);
    }
    if (version === 6 && isPrivateIpv6(address)) {
      throw new Error(`blocked private address: ${address}`);
    }
  }

  return url;
}

export type FetchedLink = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  contentType: string | null;
};

function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim() || 'Linked page';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

/** Fetch a public URL after DNS/SSRF checks. No redirects to private IPs. */
export async function fetchPublicLink(rawUrl: string): Promise<FetchedLink> {
  const url = await assertSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'user-agent': 'SashaMemoryOSLinkFetcher/0.1',
        accept: 'text/html,text/plain,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status}`);
    }
    const contentType = res.headers.get('content-type');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`response exceeds ${MAX_BYTES} bytes`);
    }
    const body = buf.toString('utf8');
    if (contentType?.includes('text/plain')) {
      const text = body.trim();
      if (!text) throw new Error('empty link body');
      return {
        url: url.toString(),
        finalUrl: res.url || url.toString(),
        title: url.hostname,
        text,
        contentType,
      };
    }
    const parsed = stripHtml(body);
    if (!parsed.text) throw new Error('no extractable text from link');
    return {
      url: url.toString(),
      finalUrl: res.url || url.toString(),
      title: parsed.title,
      text: parsed.text.slice(0, 50_000),
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}
