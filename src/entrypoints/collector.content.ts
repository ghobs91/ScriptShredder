import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  isGetPageScriptsMessage,
  recordPageScripts,
  type PageScriptsResponse,
} from '../lib/messaging';

const JAVASCRIPT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'text/jscript',
  'application/x-javascript',
]);

const MAX_SEEN_SCRIPTS = 500;

/**
 * Collects script URLs from the top frame only. It deliberately does not read
 * page text, inputs, cookies, or request data.
 *
 * The list is used for two things:
 * - the popup's per-page script list;
 * - local counters of blocked scripts.
 *
 * The background decides which URLs are third-party and actually blocked.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: false,
  noScriptStartedPostMessage: true,
  main() {
    const seen = new Set<string>();
    const pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleFlush(): void {
      if (flushTimer !== undefined) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flush();
      }, 500);
    }

    async function flush(): Promise<void> {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }

      if (pending.size === 0) return;

      const scripts = [...pending];
      pending.clear();

      try {
        await recordPageScripts(location.href, scripts);
      } catch {
        // The background may be unavailable while the extension updates.
      }
    }

    function addUrl(value: string | null | undefined): void {
      if (!value) return;

      let url: URL;
      try {
        url = new URL(value, location.href);
      } catch {
        return;
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      // Keep only origin + pathname: query strings and fragments are often
      // cache-busters, and the matching/counter layer normalizes them anyway.
      const href = `${url.origin}${url.pathname || '/'}`;
      if (seen.has(href)) return;
      if (seen.size >= MAX_SEEN_SCRIPTS) return;

      seen.add(href);
      pending.add(href);
      scheduleFlush();
    }

    function addScript(script: HTMLScriptElement): void {
      if (!script.src || !isJavaScriptType(script.getAttribute('type'))) {
        return;
      }
      addUrl(script.src);
    }

    function addLink(link: HTMLLinkElement): void {
      const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      const as = (link.getAttribute('as') ?? '').toLowerCase();

      const isModulePreload = rel.includes('modulepreload');
      const isScriptPreload = rel.includes('preload') && as === 'script';

      if (isModulePreload || isScriptPreload) addUrl(link.href);
    }

    function scanElement(element: Element): void {
      if (element instanceof HTMLScriptElement) addScript(element);
      if (element instanceof HTMLLinkElement) addLink(element);

      for (const script of element.querySelectorAll('script[src]')) {
        if (script instanceof HTMLScriptElement) addScript(script);
      }
      for (const link of element.querySelectorAll('link[rel]')) {
        if (link instanceof HTMLLinkElement) addLink(link);
      }
    }

    function scanDocument(): void {
      for (const script of document.querySelectorAll('script[src]')) {
        if (script instanceof HTMLScriptElement) addScript(script);
      }
      for (const link of document.querySelectorAll('link[rel]')) {
        if (link instanceof HTMLLinkElement) addLink(link);
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof HTMLScriptElement) {
            addScript(mutation.target);
          }
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scanElement(node);
        }
      }
    });

    observer.observe(document.documentElement ?? document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    scanDocument();

    document.addEventListener('DOMContentLoaded', scanDocument, { once: true });
    window.addEventListener(
      'load',
      () => {
        scanDocument();
        void flush();
      },
      { once: true },
    );
    window.addEventListener('pageshow', () => {
      scanDocument();
      void flush();
    });
    window.addEventListener('pagehide', () => {
      void flush();
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isGetPageScriptsMessage(message)) return false;

      sendResponse({
        pageUrl: location.href,
        scripts: [...seen],
      } satisfies PageScriptsResponse);

      return false;
    });
  },
});

function isJavaScriptType(value: string | null): boolean {
  const type = (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return type === '' || type === 'module' || JAVASCRIPT_TYPES.has(type);
}
