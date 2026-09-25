/* SatisBall — video output.
 *
 *  exportRun(): frame-perfect offline render. Re-simulates the run deterministically, renders every
 *    frame at 1080x1920, encodes with WebCodecs (H.264 + AAC in MP4; VP9 + Opus WebM fallback).
 *    Audio is rendered through the identical mixing graph in an OfflineAudioContext.
 *    Never drops a frame, however slow the machine is.
 *  LiveRecorder: MediaRecorder capture of the canvas + master mix, for quick real-time grabs.
 */
'use strict';
(function (SB) {
  const W = 1080, H = 1920, FPS = 60, SR = SB.audio.SR;

  async function pickVideo() {
    if (!window.VideoEncoder) return null;
    const bitrate = 20_000_000;
    const tries = [
      { container: 'mp4', codec: 'avc1.64002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.4d002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.42002a', mux: 'avc' },
      { container: 'mp4', codec: 'avc1.640033', mux: 'avc' },
      { container: 'webm', codec: 'vp09.00.41.08', mux: 'V_VP9' },
      { container: 'webm', codec: 'vp8', mux: 'V_VP8' },
    ];
    for (const t of tries) {
      for (const hw of ['prefer-hardware', 'no-preference']) {
        const cfg = { codec: t.codec, width: W, height: H, bitrate, framerate: FPS, hardwareAcceleration: hw, latencyMode: 'quality' };
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
  async function capabilities() {
    const v = await pickVideo();
    const a = v ? await pickAudio(v.container) : null;
    return { video: v ? v.codec : null, container: v ? v.container : null, audio: a ? a.codec : null };
  }

  /**
   * cfg: Game config (without canvas/audioMode). o: { maxSecs, onProgress(frac, label), isCancelled() }
   * Returns { blob, ext }.
   */
  async function exportRun(cfg, o = {}) {
    const maxFrames = Math.round((o.maxSecs || 75) * FPS);
    const progress = o.onProgress || (() => {});
    const cancelled = o.isCancelled || (() => false);
    const v = await pickVideo();
    if (!v) throw new Error('This browser cannot encode video (WebCodecs missing). Use Chrome or Edge, or use Live Record.');
    const a = await pickAudio(v.container);

    // ---- pass 1: simulate only, capture sound events + exact length
    progress(0, 'Simulating…');
    const simCanvas = document.createElement('canvas'); simCanvas.width = W; simCanvas.height = H;
    const g1 = new SB.Game(Object.assign({}, cfg, { canvas: simCanvas, audioMode: 'capture' }));
    let frames = 0;
    while (frames < maxFrames && g1.state !== 'done') { g1.frame(); frames++; if (frames % 600 === 0) await tick(); }
    const duration = frames / FPS;

    // ---- audio: offline render + encode up front
    const audioChunks = [];
    let audioMeta = null;
    if (a) {
      progress(0.02, 'Rendering audio…');
      const buf = await cfg.engine.renderOffline(g1.snd.events, duration);
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
        video: { codec: 'avc', width: W, height: H, frameRate: FPS },
        audio: a ? { codec: a.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
        fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      });
    } else {
      muxer = new WebMMuxer.Muxer({
        target: new WebMMuxer.ArrayBufferTarget(),
        video: { codec: v.mux, width: W, height: H, frameRate: FPS },
        audio: a ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: SR } : undefined,
        firstTimestampBehavior: 'offset',
      });
    }
    let ai = 0;
    const pushAudioUntil = (ts) => {
      while (ai < audioChunks.length && audioChunks[ai].timestamp <= ts) { muxer.addAudioChunk(audioChunks[ai], ai === 0 ? audioMeta : undefined); ai++; }
    };

    // ---- pass 2: render + encode video (same seed -> identical run)
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
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
      g2.frame(); g2.render();
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
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
    return { blob: new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), ext, duration, codec: v.codec, audio: a ? a.codec : 'none' };
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

  SB.recorder = { exportRun, LiveRecorder, download, capabilities };
})(window.SB);
