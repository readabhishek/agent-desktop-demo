// Serves the three demo apps, each on its own port.
//
// Different ports give each app its own origin (like crm.acme.com vs chat.acme.com),
// while all of them stay the same *site* (localhost), so ADT's bridge iframe embedded in
// CRM and Chat is not storage-partitioned and shares a BroadcastChannel with ADT.
// No dependencies: run with `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = 'localhost';
const APPS = {
  adt: { port: 3001, dir: 'adt' },
  crm: { port: 3002, dir: 'crm' },
  chat: { port: 3003, dir: 'chat' },
};
const origin = (app) => `http://${HOST}:${APPS[app].port}`;

// Served to every app as /shared/config.js so origins live in one place.
// In production these become https://adt.acme.com, https://crm.acme.com, https://chat.acme.com.
const CONFIG = {
  channel: 'agent-bus',
  adtOrigin: origin('adt'),
  crmOrigin: origin('crm'),
  chatOrigin: origin('chat'),
  five9Url: 'https://app.five9.com/clients/integrations/adt.li.main.html',
  five9SdkUrl: 'https://app.five9.com/dev/sdk/crm/latest/five9.crm.sdk.js',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SHARED_DIR = path.join(__dirname, 'shared');

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// Resolves a URL path inside root, refusing anything that escapes it.
function resolveIn(root, urlPath) {
  const file = path.normalize(path.join(root, urlPath));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return urlPath.endsWith('/') ? path.join(file, 'index.html') : file;
}

function handle(appName, root, req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return notFound(res);
  }

  if (urlPath === '/shared/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`window.DEMO_CONFIG = ${JSON.stringify(CONFIG, null, 2)};\n`);
    return;
  }

  const file = urlPath.startsWith('/shared/')
    ? resolveIn(SHARED_DIR, urlPath.slice('/shared'.length))
    : resolveIn(root, urlPath);
  if (!file) return notFound(res);

  const headers = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    // Process isolation (see README "Process isolation"). The apps are same-site, which
    // lets Chrome put them in one renderer process; this asks Chrome to key each origin
    // separately so a CRM freeze or crash can't reach ADT. The IsolateOrigins policy
    // makes it a guarantee.
    'Origin-Agent-Cluster': '?1',
  };
  // ADT always starts in its own browsing context group, even if CRM or Chat opens it,
  // so it never shares their process. "allow-popups" keeps popups the Five9 iframe may
  // open (e.g. an SSO login) working.
  if (appName === 'adt') {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups';
  }
  // Only CRM and Chat may embed the bridge, so no other page can listen in on the bus.
  if (appName === 'adt' && urlPath === '/bridge.html') {
    headers['Content-Security-Policy'] = `frame-ancestors ${CONFIG.crmOrigin} ${CONFIG.chatOrigin}`;
  }

  fs.readFile(file, (err, body) => {
    if (err) return notFound(res);
    res.writeHead(200, headers);
    res.end(body);
  });
}

for (const [name, app] of Object.entries(APPS)) {
  const root = path.join(__dirname, app.dir);
  http
    .createServer((req, res) => handle(name, root, req, res))
    .listen(app.port, HOST, () => console.log(`${name.padEnd(5)} ${origin(name)}`));
}
