import { describe, expect, it } from 'vitest';
import {
  normalizeFrameOrigin,
  normalizeScriptUrl,
  normalizeSiteInput,
  siteFromHostname,
  siteFromUrl,
} from './domain';

describe('siteFromUrl', () => {
  it('reduces URLs to their registrable domain', () => {
    expect(siteFromUrl('https://www.example.com/path?q=1#section')).toBe(
      'example.com',
    );
    expect(siteFromUrl('http://example.com:8080/')).toBe('example.com');
    expect(siteFromUrl('https://foo.bar.co.uk/')).toBe('bar.co.uk');
    expect(siteFromUrl('https://a.b.github.io/x')).toBe('b.github.io');
  });

  it('handles local development hosts', () => {
    expect(siteFromUrl('http://localhost:3000/')).toBe('localhost');
    expect(siteFromUrl('http://127.0.0.1:4173/')).toBe('127.0.0.1');
    expect(siteFromUrl('http://[::1]:3000/')).toBe('[::1]');
  });

  it('rejects URLs the extension cannot act on', () => {
    expect(siteFromUrl('chrome://extensions')).toBeNull();
    expect(siteFromUrl('file:///Users/me/index.html')).toBeNull();
    expect(siteFromUrl('about:blank')).toBeNull();
    expect(siteFromUrl('not a url')).toBeNull();
    expect(siteFromUrl(undefined)).toBeNull();
    expect(siteFromUrl('')).toBeNull();
  });
});

describe('siteFromHostname', () => {
  it('normalizes case and trailing dots', () => {
    expect(siteFromHostname('WWW.Example.COM.')).toBe('example.com');
  });

  it('rejects malformed hostnames', () => {
    expect(siteFromHostname('exa mple.com')).toBeNull();
    expect(siteFromHostname('example..com')).toBeNull();
    expect(siteFromHostname('-example.com')).toBeNull();
    expect(siteFromHostname('example-.com')).toBeNull();
    expect(siteFromHostname('')).toBeNull();
  });
});

describe('normalizeSiteInput', () => {
  it('accepts domains, URLs, and hosts with ports', () => {
    expect(normalizeSiteInput(' Example.COM ')).toBe('example.com');
    expect(normalizeSiteInput('https://www.example.com/path')).toBe(
      'example.com',
    );
    expect(normalizeSiteInput('example.com:8080')).toBe('example.com');
    expect(normalizeSiteInput('localhost:3000')).toBe('localhost');
    expect(normalizeSiteInput('127.0.0.1:4173')).toBe('127.0.0.1');
    expect(normalizeSiteInput('foo.github.io')).toBe('foo.github.io');
  });

  it('punycodes internationalized domains', () => {
    expect(normalizeSiteInput('münchen.de')).toBe('xn--mnchen-3ya.de');
  });

  it('rejects malformed or unsafe input', () => {
    expect(normalizeSiteInput('')).toBeNull();
    expect(normalizeSiteInput('not a domain')).toBeNull();
    expect(normalizeSiteInput('*.example.com')).toBeNull();
    expect(normalizeSiteInput('https://user:pass@example.com')).toBeNull();
    expect(normalizeSiteInput('https://example.com:bad')).toBeNull();
    expect(normalizeSiteInput('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeScriptUrl', () => {
  it('strips query strings and fragments', () => {
    expect(normalizeScriptUrl('https://cdn.example.com/a.js?v=1#x')).toBe(
      'https://cdn.example.com/a.js',
    );
    expect(normalizeScriptUrl('https://cdn.example.com/a.js?')).toBe(
      'https://cdn.example.com/a.js',
    );
    expect(normalizeScriptUrl('https://cdn.example.com')).toBe(
      'https://cdn.example.com/',
    );
    expect(normalizeScriptUrl('https://EXAMPLE.com/A.js')).toBe(
      'https://example.com/A.js',
    );
    expect(normalizeScriptUrl('http://localhost:3000/a.js')).toBe(
      'http://localhost:3000/a.js',
    );
  });

  it('rejects non-http scripts', () => {
    expect(normalizeScriptUrl('data:text/javascript,alert(1)')).toBeNull();
    expect(normalizeScriptUrl('blob:https://example.com/id')).toBeNull();
    expect(normalizeScriptUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeScriptUrl('not a url')).toBeNull();
  });
});

describe('normalizeFrameOrigin', () => {
  it('normalizes iframe URLs to their origin', () => {
    expect(
      normalizeFrameOrigin('https://www.youtube.com/embed/abc?autoplay=1'),
    ).toBe('https://www.youtube.com');
    expect(normalizeFrameOrigin('http://localhost:3000/embed')).toBe(
      'http://localhost:3000',
    );
    expect(normalizeFrameOrigin('https://EXAMPLE.com:443/embed')).toBe(
      'https://example.com',
    );
  });

  it('rejects non-http iframe URLs', () => {
    expect(normalizeFrameOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeFrameOrigin('data:text/html,hi')).toBeNull();
    expect(normalizeFrameOrigin('blob:https://example.com/id')).toBeNull();
    expect(normalizeFrameOrigin('not a url')).toBeNull();
  });
});
