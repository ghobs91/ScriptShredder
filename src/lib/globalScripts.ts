/**
 * Hosts that are allowed to load scripts and embeds on every site.
 *
 * The defaults cover content-only CDNs and captcha providers that commonly
 * break pages when their scripts are treated as third-party. Tracking,
 * advertising, analytics, and session-replay hosts are deliberately excluded.
 *
 * Entries are normalized URLs. An origin entry (host plus `/`) covers the
 * host, its subdomains, and every path; a deeper path such as
 * `https://www.google.com/recaptcha/` is a prefix on that exact host.
 */
export const DEFAULT_GLOBAL_SCRIPT_EXCEPTIONS: readonly string[] = [
  // Captchas and bot challenges.
  'https://challenges.cloudflare.com/',
  'https://hcaptcha.com/',
  'https://www.google.com/recaptcha/',
  'https://www.gstatic.com/recaptcha/',
  'https://recaptcha.net/',

  // Content and library CDNs.
  'https://cloudfront.net/',
  'https://jsdelivr.net/',
  'https://cdnjs.cloudflare.com/',
  'https://unpkg.com/',
  'https://esm.sh/',
  'https://cdn.skypack.dev/',
  'https://ajax.googleapis.com/',
  'https://code.jquery.com/',
  'https://stackpath.bootstrapcdn.com/',
  'https://cdn.tailwindcss.com/',
  'https://cdn.ampproject.org/',

  // Maps.
  'https://maps.googleapis.com/',
  'https://maps.gstatic.com/',

  // Hosted website builders.
  'https://cdn.shopify.com/',
  'https://static.parastorage.com/',
  'https://static1.squarespace.com/',
];

export const MAX_GLOBAL_SCRIPT_EXCEPTIONS = 300;

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function parseHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  return HTTP_PROTOCOLS.has(url.protocol) ? url : null;
}

/**
 * Accepts a bare host, an origin, or a URL with a path and normalizes it to
 * the value stored in settings. Bare hosts become an origin with a trailing
 * slash, which covers every path and subdomain.
 */
export function normalizeGlobalScriptInput(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;

  // Only treat explicit schemes as schemes. "localhost:3000" is host + port.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  const url = parseHttpUrl(candidate);
  if (!url || !url.hostname) return null;
  if (url.username || url.password) return null;

  const path = url.pathname || '/';
  return path === '/' ? `${url.origin}/` : `${url.origin}${path}`;
}

/**
 * True when a stored global exception covers a script or embed URL.
 *
 * Origin-root entries match the host and its subdomains, mirroring the
 * `||host^` declarativeNetRequest filter. Path entries match that exact path,
 * or every path below it when the entry ends with a slash.
 */
export function globalScriptExceptionCovers(
  exception: string,
  value: string,
): boolean {
  const allowed = parseHttpUrl(exception);
  const target = parseHttpUrl(value);
  if (!allowed || !target) return false;

  const allowedPath = allowed.pathname || '/';
  const targetPath = target.pathname || '/';
  const sameHost = allowed.hostname === target.hostname;
  const subdomain = target.hostname.endsWith(`.${allowed.hostname}`);

  // Origin entries use the `||host^` rule filter, which ignores the port.
  if (allowedPath === '/') return sameHost || subdomain;

  // Path entries use an origin-prefixed filter, so scheme and port must match.
  if (allowed.protocol !== target.protocol) return false;
  if (allowed.port !== target.port) return false;
  if (!sameHost) return false;
  if (allowedPath.endsWith('/')) return targetPath.startsWith(allowedPath);
  return targetPath === allowedPath;
}

/**
 * Builds the declarativeNetRequest `urlFilter` for a global exception.
 * Origin-root entries use the domain anchor so subdomains match too.
 */
export function globalScriptRuleFilter(exception: string): string | null {
  const url = parseHttpUrl(exception);
  if (!url) return null;

  const path = url.pathname || '/';
  return path === '/' ? `||${url.hostname}^` : `|${url.origin}${path}`;
}
