const fs = require('node:fs');
const path = require('node:path');

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

module.exports = async function addTestFixture(context, origin) {
  await context.route(`${origin}/**`, async (route) => {
    if (route.request().method() !== 'GET') return route.abort();
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const filename = path.resolve(process.cwd(), `.${pathname}`);
    if (!filename.startsWith(`${process.cwd()}${path.sep}`)) return route.abort();
    try {
      const body = await fs.promises.readFile(filename);
      return route.fulfill({
        body,
        contentType: mimeTypes[path.extname(filename)] || 'application/octet-stream',
      });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      return route.fulfill({ status: 404, body: 'Not found' });
    }
  });
};
