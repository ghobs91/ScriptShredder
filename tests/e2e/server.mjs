import { createServer } from 'node:http';

const PORT = 4173;

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ScriptShredder e2e</title>
    <link rel="preconnect" href="http://api.site.test:${PORT}" />
    <link rel="preconnect" href="http://cdn.test:${PORT}" />
    <link rel="dns-prefetch" href="//cdn.test" />
    <link rel="prefetch" href="http://cdn.test:${PORT}/prefetch.html" />
  </head>
  <body>
    <script src="/first-party.js"></script>
    <script src="http://api.site.test:${PORT}/same-site.js"></script>
    <script src="http://cdn.test:${PORT}/tracker.js"></script>
    <img
      src="http://cdn.test:${PORT}/pixel.png"
      width="1"
      height="1"
      alt=""
      attributionsrc="http://cdn.test:${PORT}/attribution"
    />
    <iframe
      src="http://widget.test:${PORT}/embed.html"
      width="320"
      height="160"
      title="Test embed"
    ></iframe>
    <a
      id="ping-link"
      href="http://site.test:${PORT}/clean?utm_source=ping&keep=1"
      ping="http://cdn.test:${PORT}/ping"
    >Ping link</a>
    <a
      id="tracking-link"
      href="http://site.test:${PORT}/clean?utm_source=link&fbclid=abc&keep=1"
    >Tracking link</a>
  </body>
</html>`;

const cleanPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Clean page</title></head>
  <body><p>clean page</p></body>
</html>`;

const embedPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Embed</title></head>
  <body><p>EMBED_LOADED</p></body>
</html>`;

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let lastImageHeaders = null;
let lastPageUrl = null;

function selectedHeaders(headers) {
  return {
    referer: headers.referer,
    'sec-gpc': headers['sec-gpc'],
    'sec-ch-ua': headers['sec-ch-ua'],
    'x-client-data': headers['x-client-data'],
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  response.setHeader('cache-control', 'no-store');

  if (url.pathname === '/') {
    lastPageUrl = request.url;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }

  if (url.pathname === '/clean') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(cleanPage);
    return;
  }

  if (url.pathname === '/embed.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(embedPage);
    return;
  }

  if (url.pathname === '/prefetch.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(cleanPage);
    return;
  }

  if (url.pathname === '/pixel.png') {
    lastImageHeaders = selectedHeaders(request.headers);
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(pixel);
    return;
  }

  if (url.pathname === '/headers.json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ image: lastImageHeaders }));
    return;
  }

  if (url.pathname === '/page-url.json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ url: lastPageUrl }));
    return;
  }

  if (url.pathname === '/reset-page-url') {
    lastPageUrl = null;
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/reset-headers') {
    lastImageHeaders = null;
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/ping') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/first-party.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('window.firstPartyLoaded = true;');
    return;
  }

  if (url.pathname === '/same-site.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('window.sameSiteLoaded = true;');
    return;
  }

  if (url.pathname === '/tracker.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end('window.thirdPartyLoaded = true;');
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e server listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
