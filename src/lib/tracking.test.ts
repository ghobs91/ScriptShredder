import { describe, expect, it } from 'vitest';
import { isTrackingParam, stripTrackingParams } from './tracking';

describe('isTrackingParam', () => {
  it('recognizes known names and prefixes case-insensitively', () => {
    expect(isTrackingParam('fbclid')).toBe(true);
    expect(isTrackingParam('FBCLID')).toBe(true);
    expect(isTrackingParam('utm_source')).toBe(true);
    expect(isTrackingParam('UTM_Campaign')).toBe(true);
    expect(isTrackingParam('mtm_campaign')).toBe(true);
    expect(isTrackingParam('keep')).toBe(false);
    expect(isTrackingParam('q')).toBe(false);
  });
});

describe('stripTrackingParams', () => {
  it('removes known parameters and keeps the rest', () => {
    expect(
      stripTrackingParams(
        'https://example.com/page?utm_source=news&fbclid=abc&keep=1&q=hello#top',
      ),
    ).toBe('https://example.com/page?keep=1&q=hello#top');
  });

  it('removes prefixed parameters case-insensitively', () => {
    expect(
      stripTrackingParams(
        'https://example.com/?UTM_Source=a&mtm_campaign=b&pk_campaign=c&keep=1',
      ),
    ).toBe('https://example.com/?keep=1');
  });

  it('removes the query entirely when only tracking parameters remain', () => {
    expect(
      stripTrackingParams('https://example.com/?gclid=abc&utm_medium=email'),
    ).toBe('https://example.com/');
  });

  it('returns unchanged URLs when nothing matches', () => {
    expect(stripTrackingParams('https://example.com/?keep=1')).toBe(
      'https://example.com/?keep=1',
    );
  });

  it('does not touch non-http or invalid URLs', () => {
    expect(stripTrackingParams('javascript:alert(1)')).toBe(
      'javascript:alert(1)',
    );
    expect(stripTrackingParams('mailto:test@example.com?subject=utm_source')).toBe(
      'mailto:test@example.com?subject=utm_source',
    );
    expect(stripTrackingParams('not a url')).toBe('not a url');
  });
});
