'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

class SpeechError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}
class LocalSpeech {
  constructor(project) {
    this.directory = path.join(project, '.voice-cache');
    this.workerPath = path.join(project, 'server/speech-worker.ps1');
    this.worker = null; this.ready = false; this.closed = false; this.starting = null;
    this.voice = ''; this.voices = []; this.failure = ''; this.queue = []; this.current = null; this.pending = new Map();
    this.cache = new Map(); this.cacheBytes = 0;
  }
  unavailable() { return new SpeechError('SPEECH_UNAVAILABLE', 503, '电脑中文语音尚未就绪，请在电脑的普通终端重新启动手机预览。'); }
  async start() {
    if (this.closed) throw this.unavailable();
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = null; }
  }
  async launch() {
    if (process.platform !== 'win32') { this.failure = 'WINDOWS_REQUIRED'; throw this.unavailable(); }
    await fs.mkdir(this.directory, { recursive: true });
    return new Promise((resolve, reject) => {
      const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const worker = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.workerPath, '-CacheDirectory', this.directory], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.worker = worker;
      let settled = false;
      const timer = setTimeout(() => { this.failure = 'VOICE_START_TIMEOUT'; worker.kill(); }, 15000);
      const lines = readline.createInterface({ input: worker.stdout });
      const lost = () => {
        clearTimeout(timer); lines.close();
        if (this.worker !== worker) return;
        this.worker = null; this.ready = false;
        this.failure = this.failure || 'VOICE_WORKER_EXITED';
        if (!settled) { settled = true; reject(this.unavailable()); }
        this.rejectPending(this.unavailable());
      };
      worker.on('error', lost); worker.on('exit', lost);
      worker.stderr.on('data', () => {});
      lines.on('line', line => {
        let reply; try { reply = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return; }
        if (reply.type === 'ready') {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          if (!reply.available) { this.failure = reply.code || 'VOICE_INIT_FAILED'; reject(this.unavailable()); worker.kill(); return; }
          this.ready = true; this.failure = ''; this.voice = reply.voice; this.voices = Array.isArray(reply.voices) ? reply.voices : []; resolve(); this.pump();
        } else if (reply.type === 'result') this.finish(reply);
      });
    });
  }
  async status() {
    try { await this.start(); } catch {}
    return { available: this.ready, engine: this.ready ? 'local-audio' : null, voice: this.ready ? this.voice : null, voices: this.ready ? this.voices : [], message: this.ready ? '中文语音已就绪' : this.unavailable().message };
  }
  async audio(text, rate = .85, voice = '') {
    if (typeof text !== 'string' || !text.trim() || text.length > 800) throw new SpeechError('INVALID_TEXT', 400, '朗读内容应为 1–800 个字符。');
    if (!Number.isFinite(rate) || rate < .35 || rate > 1.5) throw new SpeechError('INVALID_RATE', 400, '朗读速度不正确。');
    text = text.replace(/[\u0000-\u001f]/g, ' ').trim(); rate = Math.round(rate * 100) / 100;
    if (typeof voice !== 'string' || voice.length > 160) throw new SpeechError('INVALID_VOICE', 400, '发音人不正确。');
    await this.start();
    voice = voice || this.voice;
    if (!this.voices.some(item => item.id === voice)) throw new SpeechError('INVALID_VOICE', 400, '所选发音人在当前电脑不可用。');
    const key = crypto.createHash('sha256').update('zh-v2\n' + voice + '\n' + rate + '\n' + text).digest('hex');
    if (this.cache.has(key)) { const data = this.cache.get(key); this.cache.delete(key); this.cache.set(key, data); return data; }
    if (this.pending.has(key)) return this.pending.get(key).promise;
    if (this.pending.size >= 20) throw new SpeechError('SPEECH_BUSY', 429, '语音正在准备，请稍后再试。');
    // Requests may have arrived together while the engine was starting.
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key).promise;
    if (this.pending.size >= 20) throw new SpeechError('SPEECH_BUSY', 429, '语音正在准备，请稍后再试。');
    const job = { key, text, rate, voice, file: path.join(this.directory, key + '.wav') };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.pending.set(key, job); this.queue.push(job); this.pump();
    return job.promise;
  }
  pump() {
    if (this.current || !this.ready || !this.worker || !this.queue.length) return;
    const job = this.queue.shift(); this.current = job;
    job.timer = setTimeout(() => { this.failure = 'VOICE_REQUEST_TIMEOUT'; if (this.worker) this.worker.kill(); }, 20000);
    this.worker.stdin.write(JSON.stringify({ key: job.key, text: job.text, rate: job.rate, voice: job.voice }) + '\n', 'utf8', error => { if (error && this.worker) this.worker.kill(); });
  }
  async finish(reply) {
    const job = this.current;
    if (!job || job.key !== reply.key) return;
    clearTimeout(job.timer);
    try {
      if (!reply.ok) throw this.unavailable();
      const data = await fs.readFile(job.file);
      if (data.length <= 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw this.unavailable();
      this.cache.set(job.key, data); this.cacheBytes += data.length;
      while (this.cacheBytes > 32 * 1024 * 1024 || this.cache.size > 256) { const oldest = this.cache.keys().next().value; this.cacheBytes -= this.cache.get(oldest).length; this.cache.delete(oldest); }
      job.resolve(data);
    } catch (error) { job.reject(error); }
    finally {
      // Only the temporary file with this internally generated SHA-256 name is removed.
      await fs.unlink(job.file).catch(() => {});
      this.pending.delete(job.key); if (this.current === job) this.current = null; this.pump();
    }
  }
  rejectPending(error) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear(); this.queue = []; this.current = null;
  }
  close() {
    this.closed = true; this.ready = false; this.rejectPending(this.unavailable());
    if (this.worker) this.worker.kill();
  }
}
module.exports = { LocalSpeech, SpeechError };
