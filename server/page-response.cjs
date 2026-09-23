'use strict';
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { gzip } = require('node:zlib');
const { promisify } = require('node:util');
const compress = promisify(gzip);

function acceptsGzip(header = '') {
  const values = new Map(String(header).toLowerCase().split(',').map(item => {
    const [name, ...parameters] = item.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return [name.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
  return (values.has('gzip') ? values.get('gzip') : values.get('*') || 0) > 0;
}
const stamp = stat => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':');
const etag = buffer => '"' + crypto.createHash('sha256').update(buffer).digest('hex') + '"';

// Keep one compressed snapshot; check file metadata on every visit so a saved edit is visible on refresh.
function createPageResponse(filename) {
  let cached = null, loading = null;
  async function snapshot() {
    const stat = await fs.stat(filename), key = stamp(stat);
    if (cached && cached.key === key) return cached;
    if (!loading) {
      loading = (async () => {
        const identity = await fs.readFile(filename);
        const compressed = await compress(identity, { level: 6 });
        cached = { key, identity, gzip: compressed, identityTag: etag(identity), gzipTag: etag(compressed) };
      })().finally(() => { loading = null; });
    }
    await loading;
    // Recheck in case an editor replaced the page while it was being read or compressed.
    return snapshot();
  }
  return async function pageResponse(req, res) {
    const page = await snapshot(), compressed = acceptsGzip(req.headers['accept-encoding']);
    const content = compressed ? page.gzip : page.identity;
    const tag = compressed ? page.gzipTag : page.identityTag;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-cache',
      'Vary': 'Accept-Encoding',
      'ETag': tag,
      'X-Content-Type-Options': 'nosniff'
    };
    if (compressed) headers['Content-Encoding'] = 'gzip';
    const matches = String(req.headers['if-none-match'] || '').split(',').some(value => {
      const candidate = value.trim().replace(/^W\//i, '');
      return candidate === '*' || candidate === tag;
    });
    if (res.destroyed) return;
    if (matches) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, { ...headers, 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  };
}
module.exports = { createPageResponse };
