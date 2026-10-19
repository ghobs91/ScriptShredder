import { getDomain } from 'tldts';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Returns the site (eTLD+1) for a URL, or null for URLs this extension can't
 * act on. Ports, paths, and subdomains are intentionally dropped.
 */
export function siteFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return siteFromHostname(url.hostname);
}

export function siteFromHostname(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;

  // URL.hostname keeps IPv6 literals in brackets.
  if (host.startsWith('[') && host.endsWith(']')) return host;
  if (!isValidHostname(host)) return null;
  if (IPV4.test(host)) return host;

  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

/**
 * Accepts a bare domain, a full URL, or a domain with a port and normalizes it
 * to the site the allowlist stores.
 */
export function normalizeSiteInput(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;

  // Only treat explicit schemes as schemes. "localhost:3000" is a host + port.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  return siteFromHostname(url.hostname);
}

/**
 * Normalizes a concrete script URL for display, matching, and local counters.
 * Query strings and fragments are dropped so cache-busting variants collapse
 * into one entry.
 */
export function normalizeScriptUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  return `${url.origin}${url.pathname || '/'}`;
}

function isValidHostname(host: string): boolean {
  if (host.length > 253) return false;
  return host.split('.').every((label) => LABEL.test(label));
}
