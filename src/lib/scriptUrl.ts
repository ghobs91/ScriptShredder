/**
 * Pure script-URL helpers used by both the extension pages and the content
 * script. Kept separate from domain.ts so importing them does not pull the
 * public-suffix list (tldts) into every page.
 */

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

/**
 * Returns the origin URL (scheme, host, port, trailing slash) for a script
 * URL. Stored as an exception, it covers every script path on that origin.
 */
export function scriptOriginUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  return `${url.origin}/`;
}

/**
 * True when a normalized script URL represents a whole origin (root path)
 * rather than a specific script file.
 */
export function isOriginScriptUrl(value: string): boolean {
  const origin = scriptOriginUrl(value);
  return origin !== null && normalizeScriptUrl(value) === origin;
}

/**
 * True when a stored script exception covers a script URL. An exception stored
 * as an origin without a path (for example https://cdn.test/) covers every
 * path on that origin.
 */
export function scriptExceptionCovers(
  exception: string,
  script: string,
): boolean {
  return (
    exception === script ||
    (isOriginScriptUrl(exception) && script.startsWith(exception))
  );
}
