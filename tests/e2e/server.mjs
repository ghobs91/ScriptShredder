import { createServer } from 'node:http';

const PORT = 4173;

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ScriptShredder e2e</title>
  </head>
  <body>
    <script src="/first-party.js"></script>
    <script src="http://api.site.test:${PORT}/same-site.js"></script>
    <script src="http://cdn.test:${PORT}/tracker.js"></script>
  </body>
</html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  response.setHeader('cache-control', 'no-store');

  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
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
