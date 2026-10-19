import { describe, expect, it } from 'vitest';
import {
  ALLOW_RULE_ID_BASE,
  ALLOW_SCRIPT_RULE_ID_BASE,
  BLOCK_RULE_ID,
  buildDynamicRules,
} from './rules';
import type { Settings } from './settings';

const base: Settings = {
  enabled: true,
  pausedSites: [],
  scriptExceptions: [],
};

describe('buildDynamicRules', () => {
  it('returns no rules when protection is off', () => {
    expect(buildDynamicRules({ ...base, enabled: false })).toEqual([]);
  });

  it('blocks only third-party script requests', () => {
    expect(buildDynamicRules(base)).toEqual([
      {
        id: BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: {
          domainType: 'thirdParty',
          resourceTypes: ['script'],
        },
      },
    ]);
  });

  it('adds a higher-priority allow rule per paused site', () => {
    const rules = buildDynamicRules({
      ...base,
      pausedSites: ['foo.co.uk', 'example.com'],
    });

    expect(rules).toEqual([
      {
        id: BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: {
          domainType: 'thirdParty',
          resourceTypes: ['script'],
        },
      },
      {
        id: ALLOW_RULE_ID_BASE,
        priority: 2,
        action: { type: 'allowAllRequests' },
        condition: {
          urlFilter: '||example.com^',
          resourceTypes: ['main_frame'],
        },
      },
      {
        id: ALLOW_RULE_ID_BASE + 1,
        priority: 2,
        action: { type: 'allowAllRequests' },
        condition: {
          urlFilter: '||foo.co.uk^',
          resourceTypes: ['main_frame'],
        },
      },
    ]);
  });

  it('adds a highest-priority allow rule per individual script exception', () => {
    const rules = buildDynamicRules({
      ...base,
      scriptExceptions: [
        {
          site: 'example.com',
          script: 'https://cdn.other.test/tracker.js',
        },
      ],
    });

    expect(rules).toEqual([
      {
        id: BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: {
          domainType: 'thirdParty',
          resourceTypes: ['script'],
        },
      },
      {
        id: ALLOW_SCRIPT_RULE_ID_BASE,
        priority: 3,
        action: { type: 'allow' },
        condition: {
          urlFilter: '|https://cdn.other.test/tracker.js',
          initiatorDomains: ['example.com'],
          resourceTypes: ['script'],
        },
      },
    ]);
  });

  it('deduplicates paused sites', () => {
    const rules = buildDynamicRules({
      ...base,
      pausedSites: ['example.com', 'example.com'],
    });

    expect(rules).toHaveLength(2);
  });
});
