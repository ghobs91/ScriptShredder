import type { Browser } from 'wxt/browser';
import type { Settings } from './settings';

export const BLOCK_RULE_ID = 1;
export const ALLOW_RULE_ID_BASE = 1000;
export const ALLOW_SCRIPT_RULE_ID_BASE = 2000;

/**
 * The extension uses three rule shapes:
 *
 * 1. Block script requests whose initiator is a different eTLD+1 than the
 *    frame they belong to.
 * 2. For paused sites, allow every request in the top-level frame hierarchy.
 *    `allowAllRequests` is scoped to the main frame URL, so embedded
 *    third-party frames stay blocked unless the user pauses them separately.
 * 3. For individual exceptions, allow one normalized script URL when it is
 *    initiated by a specific site.
 *
 * Priorities: block 1, paused site 2, individual script 3.
 */
export function buildDynamicRules(
  settings: Settings,
): Browser.declarativeNetRequest.Rule[] {
  if (!settings.enabled) return [];

  const rules: Browser.declarativeNetRequest.Rule[] = [
    {
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: 'block' },
      condition: {
        domainType: 'thirdParty',
        resourceTypes: ['script'],
      },
    },
  ];

  const sites = [...new Set(settings.pausedSites)].sort();
  for (const [index, site] of sites.entries()) {
    rules.push({
      id: ALLOW_RULE_ID_BASE + index,
      priority: 2,
      action: { type: 'allowAllRequests' },
      condition: {
        // Domain anchor + separator matches the bare domain, subdomains, and
        // any port, but not lookalikes such as example.com.evil.test.
        urlFilter: `||${site}^`,
        resourceTypes: ['main_frame'],
      },
    });
  }

  const exceptions = [...settings.scriptExceptions].sort(
    (a, b) =>
      a.site.localeCompare(b.site) || a.script.localeCompare(b.script),
  );
  for (const [index, exception] of exceptions.entries()) {
    rules.push({
      id: ALLOW_SCRIPT_RULE_ID_BASE + index,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        // Anchor at the URL start. A query string or fragment on the actual
        // request still matches because this is a prefix filter.
        urlFilter: `|${exception.script}`,
        initiatorDomains: [exception.site],
        resourceTypes: ['script'],
      },
    });
  }

  return rules;
}
