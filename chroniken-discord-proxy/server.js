const http = require('http');

const PORT = process.env.PORT || 3000;
const CHAR_WEBHOOK = process.env.CHAR_WEBHOOK || '';

const server = http.createServer(async (req, res) => {
  // CORS – damit admin.html aufrufen darf
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/charakter') {
    if (!CHAR_WEBHOOK) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'CHAR_WEBHOOK fehlt' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body || '{}');
      const r = await fetch(CHAR_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      res.writeHead(r.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: r.ok }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log('Listening on', PORT));
