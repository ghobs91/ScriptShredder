import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { buildPageActions, summarizePageActions } from '../lib/actions';
import { globalScriptExceptionCovers } from '../lib/globalScripts';
import {
  allowIframe,
  getPageContext,
  isGetPageScriptsMessage,
  recordPageScripts,
  sendBadgeCount,
  type PageContext,
  type PageScriptsResponse,
} from '../lib/messaging';
import { stripTrackingParams } from '../lib/tracking';

const JAVASCRIPT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'text/jscript',
  'application/x-javascript',
]);

const SPECULATION_RELS = new Set([
  'dns-prefetch',
  'preconnect',
  'prefetch',
  'prerender',
]);

const MAX_SEEN_SCRIPTS = 500;
const MAX_OBSERVED_RESOURCES = 1000;
const MAX_CLEANUPS = 100;
const ACTION_SYNC_DELAY = 400;

const EMBED_STYLES = `
:host { display: block; }
.box {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px dashed #b8c0b0;
  border-radius: 10px;
  background: #f6f8f2;
  color: #11160f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.meta { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.label {
  color: #5c6758;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.host {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button {
  flex: none;
  padding: 8px 11px;
  border: 0;
  border-radius: 7px;
  background: #b9f24b;
  color: #0d120b;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
}
button:hover { background: #a8e33a; }
button:disabled { cursor: wait; opacity: 0.55; }
@media (prefers-color-scheme: dark) {
  .box { background: #121813; color: #edf2e8; border-color: #39423a; }
  .label { color: #98a393; }
}
`;

/**
 * Collects script URLs from the top frame and applies page-level hardening.
 * It deliberately does not read page text, inputs, cookies, or request data.
 *
 * The background decides which scripts are third-party and actually blocked.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: false,
  noScriptStartedPostMessage: true,
  main() {
    const seen = new Set<string>();
    const pending = new Set<string>();
    const processedIframes = new WeakSet<HTMLIFrameElement>();
    const blockedFrames: string[] = [];
    const beacons = new Set<string>();
    const resources: string[] = [];
    const cleanups: Array<{ from: string; to: string }> = [];
    const cleanupKeys = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let actionTimer: ReturnType<typeof setTimeout> | undefined;
    let pageContext: PageContext | null = null;
    let contextRequest = 0;

    function currentActivity() {
      const context = pageContext;
      if (!context?.site) return summarizePageActions([]);

      return summarizePageActions(
        buildPageActions({
          pageUrl: location.href,
          site: context.site,
          enabled: context.enabled,
          paused: context.paused,
          hardening: context.hardening,
          scriptExceptions: context.scriptExceptions ?? [],
          globalScriptExceptions: context.globalScriptExceptions ?? [],
          scripts: [...seen],
          frames: blockedFrames,
          beacons: [...beacons],
          resources,
          cleanups,
        }),
      );
    }

    function scheduleActionSync(): void {
      if (actionTimer !== undefined) return;
      actionTimer = setTimeout(() => {
        actionTimer = undefined;
        void syncActionBadge();
      }, ACTION_SYNC_DELAY);
    }

    async function syncActionBadge(): Promise<void> {
      try {
        await sendBadgeCount(currentActivity().total);
      } catch {
        // The background may be unavailable while the extension updates.
      }
    }

    function addResource(entry: PerformanceEntry): void {
      if (resources.length >= MAX_OBSERVED_RESOURCES) return;

      let url: URL;
      try {
        url = new URL(entry.name);
      } catch {
        return;
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      resources.push(`${url.origin}${url.pathname || '/'}`);
      scheduleActionSync();
    }

    function recordCleanup(from: string, to: string): void {
      if (from === to) return;

      const key = `${from}\n${to}`;
      if (cleanupKeys.has(key) || cleanups.length >= MAX_CLEANUPS) return;

      cleanupKeys.add(key);
      cleanups.push({ from, to });
      scheduleActionSync();
    }

    function addBeaconValue(value: string | null): void {
      if (!value) return;

      for (const part of value.trim().split(/\s+/)) {
        if (!part) continue;

        try {
          const url = new URL(part, location.href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

          const href = `${url.origin}${url.pathname || '/'}`;
          if (beacons.has(href)) continue;

          beacons.add(href);
          scheduleActionSync();
        } catch {
          // Ignore malformed ping/attribution values.
        }
      }
    }

    function captureBeacons(element: Element): void {
      addBeaconValue(element.getAttribute('ping'));
      addBeaconValue(element.getAttribute('attributionsrc'));
    }

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
      scheduleActionSync();
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

    function parseHttpUrl(value: string): URL | null {
      try {
        const url = new URL(value, location.href);
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? url
          : null;
      } catch {
        return null;
      }
    }

    function isActive(): boolean {
      return Boolean(
        pageContext?.site && pageContext.enabled && !pageContext.paused,
      );
    }

    function isThirdParty(value: string): boolean {
      const site = pageContext?.site;
      const url = parseHttpUrl(value);
      if (!site || !url) return false;

      const host = url.hostname.toLowerCase();
      return host !== site && !host.endsWith(`.${site}`);
    }

    function isGloballyAllowed(value: string): boolean {
      return (pageContext?.globalScriptExceptions ?? []).some((exception) =>
        globalScriptExceptionCovers(exception, value),
      );
    }

    function cssSize(value: string | null, fallback: string): string {
      if (!value) return fallback;
      const trimmed = value.trim();
      return /^\d+(?:\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
    }

    function cleanCurrentUrl(): void {
      if (!pageContext?.hardening.stripTrackingParams || !isActive()) return;

      const clean = stripTrackingParams(location.href);
      if (clean === location.href) return;

      recordCleanup(location.href, clean);

      try {
        history.replaceState(history.state, '', clean);
      } catch {
        // Some documents disallow history mutation; leave the URL alone.
      }
    }

    function cleanAnchor(anchor: HTMLAnchorElement): void {
      if (!pageContext?.hardening.stripTrackingParams || !isActive()) return;

      const clean = stripTrackingParams(anchor.href);
      if (clean !== anchor.href) {
        recordCleanup(anchor.href, clean);
        anchor.href = clean;
      }
    }

    function removeTrackingAttributes(root: ParentNode): void {
      if (!isActive() || !pageContext?.hardening.blockBeacons) return;

      if (root instanceof Element) {
        captureBeacons(root);
        if (root instanceof HTMLAnchorElement || root instanceof HTMLAreaElement) {
          root.removeAttribute('ping');
        }
        root.removeAttribute('attributionsrc');
      }

      for (const element of root.querySelectorAll('[ping], [attributionsrc]')) {
        captureBeacons(element);
        element.removeAttribute('ping');
        element.removeAttribute('attributionsrc');
      }
    }

    function removeSpeculationLink(link: HTMLLinkElement): void {
      if (
        !isActive() ||
        !pageContext?.hardening.removeSpeculationLinks
      ) {
        return;
      }

      const rels = (link.getAttribute('rel') ?? '')
        .toLowerCase()
        .split(/\s+/);
      if (!rels.some((rel) => SPECULATION_RELS.has(rel))) return;
      if (!link.getAttribute('href')) return;
      if (isThirdParty(link.href)) link.remove();
    }

    function addShadowStyles(shadow: ShadowRoot): void {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(EMBED_STYLES);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        const style = document.createElement('style');
        style.textContent = EMBED_STYLES;
        shadow.append(style);
      }
    }

    function processIframe(iframe: HTMLIFrameElement): void {
      if (
        !isActive() ||
        !pageContext?.hardening.clickToLoadIframes ||
        processedIframes.has(iframe)
      ) {
        return;
      }

      const src = iframe.getAttribute('src');
      if (!src || /^(about:|javascript:|data:|blob:)/i.test(src.trim())) {
        return;
      }

      let sourceUrl: URL;
      try {
        sourceUrl = new URL(src, location.href);
      } catch {
        return;
      }
      if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
        return;
      }

      const origin = sourceUrl.origin;
      const source = sourceUrl.href;
      if (!isThirdParty(source)) return;
      if (pageContext.iframeExceptions?.includes(origin)) return;
      if (isGloballyAllowed(source)) return;

      processedIframes.add(iframe);
      if (!blockedFrames.includes(source)) blockedFrames.push(source);
      scheduleActionSync();
      const computed = getComputedStyle(iframe);
      const rect = iframe.getBoundingClientRect();
      const declaredWidth = iframe.getAttribute('width');
      const declaredHeight = iframe.getAttribute('height');
      const hasLayout = rect.width > 2 && rect.height > 2;
      const isInvisible =
        computed.display === 'none' ||
        computed.visibility === 'hidden' ||
        (!hasLayout && !declaredWidth && !declaredHeight);

      if (isInvisible) {
        iframe.style.display = 'none';
        return;
      }

      const width = cssSize(
        declaredWidth,
        rect.width > 0 ? `${Math.round(rect.width)}px` : '100%',
      );
      const height = cssSize(
        declaredHeight,
        rect.height > 0 ? `${Math.round(rect.height)}px` : '180px',
      );

      const host = document.createElement('div');
      host.dataset.scriptshredderEmbed = origin;
      host.style.cssText = `display:block;width:${width};height:${height};min-height:120px;`;

      const shadow = host.attachShadow({ mode: 'open' });
      addShadowStyles(shadow);

      const box = document.createElement('div');
      box.className = 'box';

      const meta = document.createElement('div');
      meta.className = 'meta';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = 'Third-party embed blocked';

      const hostName = document.createElement('div');
      hostName.className = 'host';
      hostName.textContent = sourceUrl.host;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Load';
      button.title = `Load embed from ${origin} on this site`;
      button.setAttribute('aria-label', `Load embed from ${origin}`);

      meta.append(label, hostName);
      box.append(meta, button);
      shadow.append(box);

      const originalDisplay = iframe.style.display;
      iframe.style.display = 'none';
      iframe.before(host);

      button.addEventListener('click', () => {
        const site = pageContext?.site;
        if (!site) return;

        button.disabled = true;
        button.textContent = 'Loading…';

        void allowIframe(site, origin)
          .then(() => {
            const index = blockedFrames.indexOf(source);
            if (index >= 0) blockedFrames.splice(index, 1);
            scheduleActionSync();

            host.remove();
            if (!iframe.isConnected) return;

            iframe.style.display = originalDisplay;
            iframe.src = source;
          })
          .catch(() => {
            button.disabled = false;
            button.textContent = 'Try again';
          });
      });
    }

    function scanElement(element: Element): void {
      if (element instanceof HTMLScriptElement) addScript(element);
      if (element instanceof HTMLLinkElement) {
        addLink(element);
        removeSpeculationLink(element);
      }
      if (element instanceof HTMLIFrameElement) processIframe(element);

      removeTrackingAttributes(element);

      for (const script of element.querySelectorAll('script[src]')) {
        if (script instanceof HTMLScriptElement) addScript(script);
      }
      for (const link of element.querySelectorAll('link[rel]')) {
        if (!(link instanceof HTMLLinkElement)) continue;
        addLink(link);
        removeSpeculationLink(link);
      }
      for (const iframe of element.querySelectorAll('iframe')) {
        if (iframe instanceof HTMLIFrameElement) processIframe(iframe);
      }
    }

    function scanDocument(): void {
      for (const script of document.querySelectorAll('script[src]')) {
        if (script instanceof HTMLScriptElement) addScript(script);
      }
      for (const link of document.querySelectorAll('link[rel]')) {
        if (!(link instanceof HTMLLinkElement)) continue;
        addLink(link);
        removeSpeculationLink(link);
      }
      for (const iframe of document.querySelectorAll('iframe')) {
        if (iframe instanceof HTMLIFrameElement) processIframe(iframe);
      }
      removeTrackingAttributes(document);
    }

    function applyDomHardening(): void {
      if (!pageContext?.site) return;

      cleanCurrentUrl();
      removeSpeculationLinks(document);
      removeTrackingAttributes(document);

      if (!isActive()) return;

      for (const iframe of document.querySelectorAll('iframe')) {
        if (iframe instanceof HTMLIFrameElement) processIframe(iframe);
      }
    }

    function removeSpeculationLinks(root: ParentNode): void {
      if (!isActive() || !pageContext?.hardening.removeSpeculationLinks) return;

      for (const link of root.querySelectorAll('link[rel]')) {
        if (link instanceof HTMLLinkElement) removeSpeculationLink(link);
      }
    }

    async function refreshContext(): Promise<void> {
      const request = ++contextRequest;

      try {
        const context = await getPageContext(location.href);
        if (request !== contextRequest) return;
        pageContext = context;
      } catch {
        if (request !== contextRequest) return;
        pageContext = null;
      }

      applyDomHardening();
      void syncActionBadge();
    }

    const resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) addResource(entry);
    });
    try {
      resourceObserver.observe({ type: 'resource', buffered: true });
    } catch {
      // Resource Timing is unavailable; scripts and DOM actions still work.
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof HTMLScriptElement) {
            addScript(mutation.target);
          }
          if (
            mutation.target instanceof HTMLIFrameElement &&
            mutation.attributeName === 'src'
          ) {
            processIframe(mutation.target);
          }
          if (
            mutation.target instanceof Element &&
            (mutation.attributeName === 'ping' ||
              mutation.attributeName === 'attributionsrc')
          ) {
            removeTrackingAttributes(mutation.target);
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
      attributeFilter: ['src', 'ping', 'attributionsrc'],
    });

    scanDocument();
    void refreshContext();
    // Clear any badge left by the previous document before the new context
    // and resource entries arrive.
    void syncActionBadge();

    window.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        const anchor = event.target.closest('a[href]');
        if (anchor instanceof HTMLAnchorElement) cleanAnchor(anchor);
      },
      true,
    );
    window.addEventListener(
      'auxclick',
      (event) => {
        if (!(event.target instanceof Element)) return;
        const anchor = event.target.closest('a[href]');
        if (anchor instanceof HTMLAnchorElement) cleanAnchor(anchor);
      },
      true,
    );

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.settings) return;
      void refreshContext();
    });

    document.addEventListener('DOMContentLoaded', scanDocument, { once: true });
    window.addEventListener(
      'load',
      () => {
        scanDocument();
        cleanCurrentUrl();
        void flush();
        void syncActionBadge();
      },
      { once: true },
    );
    window.addEventListener('pageshow', () => {
      scanDocument();
      cleanCurrentUrl();
      void flush();
      void syncActionBadge();
    });
    window.addEventListener('pagehide', () => {
      void flush();
    });

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isGetPageScriptsMessage(message)) return false;

      sendResponse({
        pageUrl: location.href,
        scripts: [...seen],
        activity: currentActivity(),
      } satisfies PageScriptsResponse);

      return false;
    });
  },
});

function isJavaScriptType(value: string | null): boolean {
  const type = (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return type === '' || type === 'module' || JAVASCRIPT_TYPES.has(type);
}
