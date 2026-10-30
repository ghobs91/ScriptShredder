import { describe, expect, it } from 'vitest';
import {
  ALLOW_GLOBAL_SCRIPT_RULE_ID_BASE,
  ALLOW_IFRAME_RULE_ID_BASE,
  ALLOW_RULE_ID_BASE,
  ALLOW_SCRIPT_RULE_ID_BASE,
  BLOCK_RULE_ID,
  FINGERPRINT_HEADERS_RULE_ID,
  GPC_RULE_ID,
  REFERER_RULE_ID,
  TRACKING_PARAM_RULE_ID_BASE,
  X_CLIENT_DATA_RULE_ID,
  buildDynamicRules,
} from './rules';
import { DEFAULT_HARDENING, type Settings } from './settings';

const base: Settings = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
  iframeExceptions: [],
  globalScriptExceptions: [],
  hardening: { ...DEFAULT_HARDENING },
};

function ruleById(rules: ReturnType<typeof buildDynamicRules>, id: number) {
  return rules.find((rule) => rule.id === id);
}

describe('buildDynamicRules', () => {
  it('returns no rules when protection is off', () => {
    expect(buildDynamicRules({ ...base, enabled: false })).toEqual([]);
  });

  it('blocks scripts plus the enabled third-party channels', () => {
    const block = ruleById(buildDynamicRules(base), BLOCK_RULE_ID);

    expect(block).toEqual({
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: 'block' },
      condition: {
        domainType: 'thirdParty',
        resourceTypes: ['script', 'ping', 'csp_report', 'sub_frame'],
      },
    });
  });

  it('can limit blocking back to scripts only', () => {
    const block = ruleById(
      buildDynamicRules({
        ...base,
        hardening: {
          ...base.hardening,
          blockBeacons: false,
          clickToLoadIframes: false,
        },
      }),
      BLOCK_RULE_ID,
    );

    expect(block?.condition.resourceTypes).toEqual(['script']);
  });

  it('adds a higher-priority allow rule per paused site', () => {
    const rules = buildDynamicRules({
      ...base,
      pausedSites: ['foo.co.uk', 'example.com'],
    });

    expect(ruleById(rules, ALLOW_RULE_ID_BASE)).toEqual({
      id: ALLOW_RULE_ID_BASE,
      priority: 2,
      action: { type: 'allowAllRequests' },
      condition: {
        urlFilter: '||example.com^',
        resourceTypes: ['main_frame'],
      },
    });
    expect(ruleById(rules, ALLOW_RULE_ID_BASE + 1)).toBeDefined();
  });

  it('adds an allow rule per individual script exception', () => {
    const rules = buildDynamicRules({
      ...base,
      scriptExceptions: [
        {
          site: 'example.com',
          script: 'https://cdn.other.test/tracker.js',
        },
      ],
    });

    expect(ruleById(rules, ALLOW_SCRIPT_RULE_ID_BASE)).toEqual({
      id: ALLOW_SCRIPT_RULE_ID_BASE,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        urlFilter: '|https://cdn.other.test/tracker.js',
        initiatorDomains: ['example.com'],
        resourceTypes: ['script'],
      },
    });
  });

  it('allows every path when the exception is an origin', () => {
    const rules = buildDynamicRules({
      ...base,
      scriptExceptions: [
        {
          site: 'example.com',
          script: 'https://github.githubassets.com/',
        },
      ],
    });

    expect(ruleById(rules, ALLOW_SCRIPT_RULE_ID_BASE)).toEqual({
      id: ALLOW_SCRIPT_RULE_ID_BASE,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        // Prefix filters have no path wildcard, so the trailing slash covers
        // every script on the origin.
        urlFilter: '|https://github.githubassets.com/',
        initiatorDomains: ['example.com'],
        resourceTypes: ['script'],
      },
    });
  });

  it('allows global script hosts for every initiator', () => {
    const rules = buildDynamicRules({
      ...base,
      globalScriptExceptions: [
        'https://cloudfront.net/',
        'https://www.google.com/recaptcha/',
      ],
    });

    expect(ruleById(rules, ALLOW_GLOBAL_SCRIPT_RULE_ID_BASE)).toEqual({
      id: ALLOW_GLOBAL_SCRIPT_RULE_ID_BASE,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        urlFilter: '||cloudfront.net^',
        resourceTypes: ['script', 'sub_frame'],
      },
    });
    expect(ruleById(rules, ALLOW_GLOBAL_SCRIPT_RULE_ID_BASE + 1)).toEqual({
      id: ALLOW_GLOBAL_SCRIPT_RULE_ID_BASE + 1,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        urlFilter: '|https://www.google.com/recaptcha/',
        resourceTypes: ['script', 'sub_frame'],
      },
    });
  });

  it('adds an allow rule per iframe exception', () => {
    const rules = buildDynamicRules({
      ...base,
      iframeExceptions: [
        { site: 'example.com', frame: 'https://www.youtube.com' },
      ],
    });

    expect(ruleById(rules, ALLOW_IFRAME_RULE_ID_BASE)).toEqual({
      id: ALLOW_IFRAME_RULE_ID_BASE,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        urlFilter: '|https://www.youtube.com/',
        initiatorDomains: ['example.com'],
        resourceTypes: ['sub_frame'],
      },
    });
  });

  it('adds navigation redirects for tracking parameters', () => {
    const redirects = buildDynamicRules(base).filter(
      (rule) => rule.action.type === 'redirect',
    );

    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects[0]?.id).toBe(TRACKING_PARAM_RULE_ID_BASE);
    expect(redirects[0]?.priority).toBe(4);
    expect(redirects[0]?.condition.resourceTypes).toEqual([
      'main_frame',
      'sub_frame',
    ]);
    expect(redirects[0]?.condition.isUrlFilterCaseSensitive).toBe(true);
    expect(
      redirects.some((rule) =>
        rule.condition.regexFilter?.includes('fbclid'),
      ),
    ).toBe(true);
    expect(
      redirects.some((rule) =>
        rule.condition.regexFilter?.includes('utm_source'),
      ),
    ).toBe(true);
    expect(
      redirects.every((rule) =>
        rule.action.redirect?.transform?.queryTransform?.removeParams?.includes(
          'utm_source',
        ),
      ),
    ).toBe(true);
  });

  it('can omit the navigation redirect for compatibility fallback', () => {
    const rules = buildDynamicRules(base, {
      includeHeaderRules: true,
      includeNavigationRedirects: false,
    });

    expect(rules.some((rule) => rule.action.type === 'redirect')).toBe(false);
  });

  it('adds header hardening rules that are enabled', () => {
    const rules = buildDynamicRules({
      ...base,
      hardening: {
        ...base.hardening,
        removeThirdPartyReferer: true,
        reduceFingerprintHeaders: true,
        sendGpc: true,
      },
    });

    expect(ruleById(rules, REFERER_RULE_ID)?.action.type).toBe(
      'modifyHeaders',
    );
    expect(ruleById(rules, FINGERPRINT_HEADERS_RULE_ID)?.action.type).toBe(
      'modifyHeaders',
    );
    expect(ruleById(rules, X_CLIENT_DATA_RULE_ID)?.action.type).toBe(
      'modifyHeaders',
    );
    expect(ruleById(rules, GPC_RULE_ID)?.action).toEqual({
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Sec-GPC', operation: 'set', value: '1' },
      ],
    });
  });

  it('omits header rules when disabled', () => {
    const rules = buildDynamicRules({
      ...base,
      hardening: {
        ...base.hardening,
        removeThirdPartyReferer: false,
        reduceFingerprintHeaders: false,
        sendGpc: false,
      },
    });

    expect(ruleById(rules, REFERER_RULE_ID)).toBeUndefined();
    expect(ruleById(rules, FINGERPRINT_HEADERS_RULE_ID)).toBeUndefined();
    expect(ruleById(rules, X_CLIENT_DATA_RULE_ID)).toBeUndefined();
    expect(ruleById(rules, GPC_RULE_ID)).toBeUndefined();
  });

  it('can omit all header rules for the compatibility fallback', () => {
    const rules = buildDynamicRules(
      {
        ...base,
        hardening: {
          ...base.hardening,
          removeThirdPartyReferer: true,
        },
      },
      { includeHeaderRules: false },
    );

    expect(ruleById(rules, REFERER_RULE_ID)).toBeUndefined();
    expect(ruleById(rules, BLOCK_RULE_ID)).toBeDefined();
  });

  it('deduplicates paused sites', () => {
    const rules = buildDynamicRules({
      ...base,
      pausedSites: ['example.com', 'example.com'],
    });

    expect(
      rules.filter((rule) => rule.action.type === 'allowAllRequests'),
    ).toHaveLength(1);
  });
});
