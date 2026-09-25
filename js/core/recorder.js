/* SatisBall — video output.
 *
 *  exportRun(): frame-perfect offline render. Re-simulates the run deterministically, renders every
 *    frame (720p / 1080p / 1440p, 30 or 60 fps), encodes with WebCodecs (H.264 + AAC in MP4; VP9 + Opus WebM fallback).
 *    Audio is rendered through the identical mixing graph in an OfflineAudioContext.
 *    Never drops a frame, however slow the machine is.
 *  LiveRecorder: MediaRecorder capture of the canvas + master mix, for quick real-time grabs.
 */
'use strict';
(function (SB) {
  const W = 1080, H = 1920, FPS = 60, SR = SB.audio.SR;
  const QUALITY = { standard: 0.55, high: 1, max: 1.8 };
  /** Bitrate that keeps fast-moving particles clean: ~20 Mbps at 1080p60 "high", scaled by pixels and fps. */
  const bitrateFor = (w, h, fps, q = 'high') => Math.round(20_000_000 * (w * h) / (W * H) * (0.55 + 0.45 * fps / 60) * (QUALITY[q] || 1));

  async function pickVideo(force, o = {}) {
    if (!window.VideoEncoder) return null;
    const w = o.width || W, h = o.height || H, fps = o.fps || FPS;
    const bitrate = o.bitrate || bitrateFor(w, h, fps, o.quality);
    // H.264 level must cover the frame size: 4.2 up to 1080p60, 5.1 for 1440p
    const big = w * h > 1080 * 1920;
    const tries = (big ? [
      { container: 'mp4', codec: 'avc1.640033', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.4d0033', mux: 'avc' },
    ] : [
      { container: 'mp4', codec: 'avc1.64002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.4d002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.42002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.640033', mux: 'avc' },
    ]).concat([
      { container: 'webm', codec: 'vp09.00.41.08', mux: 'V_VP9' },
      { container: 'webm', codec: 'vp8', mux: 'V_VP8' },
    ]);
    if (force === 'mp4-vp9') tries.unshift({ container: 'mp4', codec: 'vp09.00.41.08', mux: 'vp9' }); // test hook
    for (const t of tries) {
      for (const hw of ['prefer-hardware', 'no-preference']) {
        const cfg = { codec: t.codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: 'quality' };
        if (t.mux === 'avc') cfg.avc = { format: 'avc' };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return Object.assign({}, t, { cfg: r.config }); } catch (e) { /* try next */ }
      }
    }
    return null;
  }
  async function pickAudio(container) {
    if (!window.AudioEncoder) return null;
    const tries = container === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'A_OPUS']];
    for (const [codec, mux] of tries) {
      const cfg = { codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192_000 };
      try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { codec, mux, cfg: r.config }; } catch (e) { /* next */ }
    }
    return null;
  }
  /** What this browser can export (for the UI). */
  async function capabilities(o = {}) {
    const v = await pickVideo(null, o);
    const a = v ? await pickAudio(v.container) : null;
    return { video: v ? v.codec : null, container: v ? v.container : null, audio: a ? a.codec : null };
  }

  /**
   * cfg: Game config (without canvas/audioMode).
   * o: { width, height, fps, quality, bitrate, maxSecs, limit (hard cut, s), onProgress(frac, label), isCancelled() }
   * Returns { blob, ext, duration, codec, audio, width, height, fps }.
   */
  async function exportRun(cfg, o = {}) {
    const w = o.width || W, h = o.height || H, fps = o.fps === 30 ? 30 : FPS, steps = 240 / fps;
    const secs = o.limit > 0 ? Math.min(o.limit, o.maxSecs || 1e9) : (o.maxSecs || 75);
    const maxFrames = Math.round(secs * fps);
    const progress = o.onProgress || (() => {});
    const cancelled = o.isCancelled || (() => false);
    const v = await pickVideo(o.force, { width: w, height: h, fps, quality: o.quality, bitrate: o.bitrate });
    if (!v) throw new Error('This browser cannot encode video (WebCodecs missing). Use Chrome or Edge, or use Live Record.');
    const a = await pickAudio(v.container);

    // ---- pass 1: simulate only, capture sound events + exact length
    progress(0, 'Simulating…');
    const simCanvas = document.createElement('canvas'); simCanvas.width = w; simCanvas.height = h;
    const g1 = new SB.Game(Object.assign({}, cfg, { canvas: simCanvas, audioMode: 'capture' }));
    let frames = 0;
    while (frames < maxFrames && g1.state !== 'done') { g1.frame(steps); frames++; if (frames % 600 === 0) { await tick(); if (cancelled()) throw new Error('cancelled'); } }
    const duration = frames / fps;

    // ---- audio: offline render + encode up front
    const audioChunks = [];
    let audioMeta = null;
    if (a) {
      progress(0.02, 'Rendering audio…');
      // a video frame shows the state at the END of its 1/fps slice, so events inside the slice are seen
      // up to one frame "early": shift the audio half a frame earlier to centre the error on zero
      const buf = await cfg.engine.renderOffline(g1.snd.events, duration, -0.5 / fps);
      const enc = new AudioEncoder({ output: (c, m) => { audioChunks.push(c); if (m && m.decoderConfig) audioMeta = m; }, error: (e) => console.error(e) });
      enc.configure(a.cfg);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const N = Math.min(buf.length, Math.round(duration * SR));
      const step = 4800;
      for (let i = 0; i < N; i += step) {
        const n = Math.min(step, N - i);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data });
        enc.encode(ad); ad.close();
      }
      await enc.flush(); enc.close();
    }

    // ---- muxer
    let muxer;
    if (v.container === 'mp4') {
      muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: v.mux, width: w, height: h, frameRate: fps },
        audio: a ? { codec: a.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
        fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      });
    } else {
      muxer = new WebMMuxer.Muxer({
        target: new WebMMuxer.ArrayBufferTarget(),
        video: { codec: v.mux, width: w, height: h, frameRate: fps },
        audio: a ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: SR } : undefined,
        firstTimestampBehavior: 'offset',
      });
    }
    let ai = 0;
    const pushAudioUntil = (ts) => {
      while (ai < audioChunks.length && audioChunks[ai].timestamp <= ts) { muxer.addAudioChunk(audioChunks[ai], ai === 0 ? audioMeta : undefined); ai++; }
    };

    // ---- pass 2: render + encode video (same seed -> identical run)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const g2 = new SB.Game(Object.assign({}, cfg, { canvas, audioMode: 'mute' }));
    let encErr = null;
    const venc = new VideoEncoder({
      output: (chunk, meta) => { pushAudioUntil(chunk.timestamp); muxer.addVideoChunk(chunk, meta); },
      error: (e) => { encErr = e; },
    });
    venc.configure(v.cfg);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (cancelled()) { venc.close(); throw new Error('cancelled'); }
      if (encErr) throw encErr;
      g2.frame(steps); g2.render();
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await tick(2);
      if (i % 8 === 0) {
        const el = (performance.now() - t0) / 1000, k = (i + 1) / frames;
        const eta = el / k - el;
        progress(0.05 + 0.93 * k, `Frame ${i + 1} / ${frames} · ${Math.max(0, Math.ceil(eta))}s left`);
        await tick();
      }
    }
    await venc.flush(); venc.close();
    pushAudioUntil(Infinity);
    muxer.finalize();
    progress(1, 'Done');
    const buf = muxer.target.buffer;
    const ext = v.container;
    return { blob: new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), ext, duration, codec: v.codec, audio: a ? a.codec : 'none', width: w, height: h, fps, winner: g1.winInfo ? g1.winInfo.title : '' };
  }
  function tick(ms = 0) { return new Promise((r) => setTimeout(r, ms)); }

  /** Real-time capture of the preview canvas + master audio. */
  class LiveRecorder {
    constructor(canvas, engine) {
      const stream = canvas.captureStream(FPS);
      try { engine.stream().getAudioTracks().forEach((t) => stream.addTrack(t)); } catch (e) { console.warn('no audio track', e); }
      const types = ['video/mp4;codecs=avc1.64002a,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      this.mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 16_000_000, audioBitsPerSecond: 192_000 });
      this.parts = [];
      this.rec.ondataavailable = (e) => { if (e.data.size) this.parts.push(e.data); };
    }
    start() { this.rec.start(250); }
    stop() {
      return new Promise((res) => {
        this.rec.onstop = () => res({ blob: new Blob(this.parts, { type: this.mime || 'video/webm' }), ext: this.mime.includes('mp4') ? 'mp4' : 'webm' });
        this.rec.stop();
      });
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Save into a user-picked folder (File System Access API) or fall back to a download. */
  async function saveTo(dir, blob, name) {
    if (!dir) { download(blob, name); return 'download'; }
    const fh = await dir.getFileHandle(name, { create: true });
    const ws = await fh.createWritable(); await ws.write(blob); await ws.close();
    return 'folder';
  }

  SB.recorder = { exportRun, LiveRecorder, download, saveTo, capabilities, bitrateFor, RESOLUTIONS: { 720: [720, 1280], 1080: [1080, 1920], 1440: [1440, 2560] } };
})(window.SB);
