'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { LocalSpeech } = require('./server/speech-service.cjs');
const { OnlineSpeech } = require('./server/online-speech.cjs');
const { createPageResponse } = require('./server/page-response.cjs');
const { createUpdateService } = require('./server/update-service.cjs');
const speech = new LocalSpeech(__dirname);
const onlineSpeech = new OnlineSpeech(__dirname);
const checkUpdate = createUpdateService(__dirname);

const androidPage = path.join(__dirname, 'app', 'src', 'main', 'assets', 'index.html');
const pageFile = fs.existsSync(androidPage) ? androidPage : path.join(__dirname, '密码图卡乐园.html');
const pageResponse = createPageResponse(pageFile);
const port = Number(process.env.PICTURE_GAME_PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('预览端口必须是 1 到 65535 之间的整数。');
  process.exit(1);
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' }); res.end(body);
}
function audioResponse(req, res, audio, contentType = 'audio/wav') {
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  let start = 0, end = audio.length - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + audio.length }); res.end(); return; }
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    else start = Math.max(0, audio.length - Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= audio.length) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + audio.length }); res.end(); return; }
    status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + audio.length;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : audio.subarray(start, end + 1));
}

// Serve the game and locally generated speech only; never expose arbitrary files.
const server = http.createServer(async (req, res) => {
  let pathname, url;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (pathname === '/api/app/update') {
    const update = await checkUpdate();
    if (!res.destroyed) json(res, update.available ? 200 : 503, update);
    return;
  }
  if (pathname === '/api/speech/status') {
    onlineSpeech.refresh();
    const status = await speech.status();
    const voices = [...status.voices, ...onlineSpeech.voices];
    if (!res.destroyed) json(res, 200, { ...status, available: voices.length > 0, voices, onlineRequiresNetwork: true });
    return;
  }
  if (pathname === '/api/speech') {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const voice = url.searchParams.get('voice') || '', online = voice.startsWith('online:');
      const data = await (online ? onlineSpeech : speech).audio(url.searchParams.get('text'), url.searchParams.has('rate') ? Number(url.searchParams.get('rate')) : .9, voice, { prefetch: req.headers['x-speech-prefetch'] === '1', signal: controller.signal });
      if (!res.destroyed) audioResponse(req, res, data, online ? 'audio/mpeg' : 'audio/wav');
    } catch (error) { if (!res.destroyed) json(res, error.status || 503, { error: error.code || 'SPEECH_UNAVAILABLE', message: error.status ? error.message : '语音暂时无法播放，请稍后再试。' }); }
    return;
  }
  if (!['/', '/index.html', '/密码图卡乐园.html'].includes(pathname)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    await pageResponse(req, res);
  } catch {
    res.writeHead(500); res.end('Game page could not be read.');
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `端口 ${port} 已被占用；若已启动本项目预览，直接使用原地址即可。`
    : '预览启动失败：' + error.message);
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log('童趣学堂：手机局域网预览已启动。');
  console.log(`电脑地址：http://127.0.0.1:${port}/`);
  console.log('手机和电脑连接同一局域网，手机浏览器打开：');
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (/loopback|virtual|vmware|vbox|wsl|vpn|tailscale|vethernet/i.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        console.log(`  http://${address.address}:${port}/  (${name})`);
      }
    }
  }
  console.log('保存 index.html 后，刷新手机浏览器即可看到修改。');
  speech.status().then(status => console.log(status.available ? '中文语音已就绪，手机可直接播放，不依赖浏览器的朗读功能。' : status.message));
  onlineSpeech.refresh().then(voices => console.log('在线中文发音人：' + voices.length + ' 个，播放时需要联网。'));
  console.log('预览期间保持终端运行，按 Ctrl+C 停止。');
});
server.on('close', () => { speech.close(); onlineSpeech.close(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { speech.close(); onlineSpeech.close(); server.close(() => process.exit(0)); });
