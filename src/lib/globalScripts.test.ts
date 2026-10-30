import { describe, expect, it } from 'vitest';
import {
  globalScriptExceptionCovers,
  globalScriptRuleFilter,
  normalizeGlobalScriptInput,
} from './globalScripts';

describe('normalizeGlobalScriptInput', () => {
  it('turns a bare host into an origin that covers every path', () => {
    expect(normalizeGlobalScriptInput('cloudfront.net')).toBe(
      'https://cloudfront.net/',
    );
    expect(normalizeGlobalScriptInput('https://cdn.jsdelivr.net')).toBe(
      'https://cdn.jsdelivr.net/',
    );
  });

  it('keeps a deeper path for a path-scoped exception', () => {
    expect(
      normalizeGlobalScriptInput('https://www.google.com/recaptcha/'),
    ).toBe('https://www.google.com/recaptcha/');
  });

  it('rejects values that are not usable HTTP URLs', () => {
    expect(normalizeGlobalScriptInput('')).toBeNull();
    expect(normalizeGlobalScriptInput('not a host')).toBeNull();
    expect(normalizeGlobalScriptInput('javascript:alert(1)')).toBeNull();
    expect(
      normalizeGlobalScriptInput('https://user:pass@example.com/'),
    ).toBeNull();
  });
});

describe('globalScriptExceptionCovers', () => {
  it('covers the host, its subdomains, and every path', () => {
    const exception = 'https://cloudfront.net/';

    expect(
      globalScriptExceptionCovers(exception, 'https://cloudfront.net/app.js'),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://d111.cloudfront.net/assets/app.js',
      ),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://cloudfront.net.evil.test/app.js',
      ),
    ).toBe(false);
  });

  it('matches any port for origin entries and requires the port for paths', () => {
    expect(
      globalScriptExceptionCovers(
        'https://cdn.test/',
        'http://cdn.test:4173/tracker.js',
      ),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        'https://cdn.test:8443/',
        'http://cdn.test:4173/tracker.js',
      ),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        'https://cdn.test:8443/app/',
        'https://cdn.test:4173/app/tracker.js',
      ),
    ).toBe(false);
  });

  it('covers every script below a trailing-slash path', () => {
    const exception = 'https://www.google.com/recaptcha/';

    expect(
      globalScriptExceptionCovers(
        exception,
        'https://www.google.com/recaptcha/api.js',
      ),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://www.google.com/recaptcha/enterprise.js',
      ),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://www.google.com/recaptcha-evil.js',
      ),
    ).toBe(false);
    expect(
      globalScriptExceptionCovers(
        exception,
        'http://www.google.com/recaptcha/api.js',
      ),
    ).toBe(false);
  });

  it('only matches a specific path exactly', () => {
    const exception = 'https://cdn.other.test/app.js';

    expect(
      globalScriptExceptionCovers(exception, 'https://cdn.other.test/app.js'),
    ).toBe(true);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://cdn.other.test/app.js/v2.js',
      ),
    ).toBe(false);
    expect(
      globalScriptExceptionCovers(
        exception,
        'https://sub.cdn.other.test/app.js',
      ),
    ).toBe(false);
  });
});

describe('globalScriptRuleFilter', () => {
  it('uses a domain anchor for origin entries', () => {
    expect(globalScriptRuleFilter('https://cloudfront.net/')).toBe(
      '||cloudfront.net^',
    );
  });

  it('uses a URL prefix for path entries', () => {
    expect(
      globalScriptRuleFilter('https://www.google.com/recaptcha/'),
    ).toBe('|https://www.google.com/recaptcha/');
  });

  it('returns null for invalid entries', () => {
    expect(globalScriptRuleFilter('javascript:alert(1)')).toBeNull();
  });
});
