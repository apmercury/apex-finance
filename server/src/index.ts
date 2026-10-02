import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { handleApiRequest } from './routes/api.ts';
import { seedDemoData } from './db/seed.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const CLIENT_DIR = path.join(process.cwd(), 'client', 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Seed initial database if needed
seedDemoData();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';

    // 1. API Route handler
    if (pathname.startsWith('/api/')) {
      const handled = await handleApiRequest(req, res);
      if (handled) return;
    }

    // 2. Static File Serving from client/public
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '') {
      safePath = '/index.html';
    }

    let filePath = path.join(CLIENT_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // 3. SPA Fallback (Serve index.html for client-side navigation)
    const indexPath = path.join(CLIENT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (error: any) {
    console.error('Server error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
});

server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    // Port is already occupied (e.g. tests running against active daemon instance)
  } else {
    console.error('Server error:', e);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ApexFinance Server running at http://${HOST}:${PORT}`);
});

export { server };
