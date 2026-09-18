const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8000;
const root = __dirname;
const entryPoint = path.join(root, 'index.html');

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const filePath = requestPath === '/' ? entryPoint : path.join(root, path.normalize(requestPath));

  if (filePath !== entryPoint) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to load Neon Drift.');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(content);
  });
});

server.listen(port, host, () => {
  console.log(`Neon Drift running at http://${host}:${port}/`);
});