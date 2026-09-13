const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const targetPath = path.resolve(rootDirectory, relativePath);
  if (!targetPath.startsWith(rootDirectory + path.sep) && targetPath !== rootDirectory) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(targetPath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(targetPath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(content);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`圖書館系統本機預覽服務已啟動：http://localhost:${port}/`);
});
