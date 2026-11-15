// 環境音混音桌 — Web Audio 合成（即時 AudioContext 與離線 OfflineAudioContext 共用）
// 每個聲音事件都是「自己的節點＋自己的包絡」，互相重疊也不會打架；連續的底噪用循環的噪音緩衝。
import { CHANNELS, GEN, rng, clamp, activeIds } from './engine.js';

// 各軌音量校正（讓 lv=1 時各軌響度相近；由 tools/measure 量測後調整）
export const CAL = { rain: 1.27, thunder: 1.54, waves: 1.16, wind: 1.17, fire: 1.05, stream: 1.6, birds: 4.3, crickets: 2.8, cafe: 1.53, typing: 1.97, clock: 1.67, noise: 0.44, pad: 1.38 };
// 送到殘響的比例
const REV = { rain: 0.15, thunder: 0.6, waves: 0.2, wind: 0.1, fire: 0.15, stream: 0.2, birds: 0.55, crickets: 0.35, cafe: 0.35, typing: 0.18, clock: 0.35, noise: 0, pad: 0.5 };

/* ---------- 噪音緩衝（固定種子，匯出可重現） ---------- */
function noiseBuffers(ctx, seed) {
  const sec = 6, len = Math.floor(ctx.sampleRate * sec);
  const mk = (kind, ch) => {
    const b = ctx.createBuffer(ch, len, ctx.sampleRate);
    for (let c = 0; c < ch; c++) {
      const d = b.getChannelData(c), r = rng(seed + c * 7919 + kind.length * 104729);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // 頭尾 20ms 交叉淡化，循環時不會喀一聲
      const xf = Math.floor(ctx.sampleRate * 0.02);
      for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[len - xf + i] * (1 - a); }
    }
    return b;
  };
  return { white: mk('white', 2), pink: mk('pink', 2), brown: mk('brown', 2), whiteM: mk('white', 1) };
}
function makeIR(ctx, sec, seed) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), r = rng(seed + c); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  return b;
}

export class Mixer {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    this.buf = noiseBuffers(ctx, 12345);
    this.r = rng(this.seed);
    const c = ctx;
    this.bus = c.createGain();
    this.revIn = c.createGain();
    const conv = c.createConvolver(); conv.buffer = makeIR(c, 2.6, 99);
    const revOut = c.createGain(); revOut.gain.value = 0.55;
    this.revIn.connect(conv).connect(revOut);
    this.tone = c.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.Q.value = 0.5;
    this.bus.connect(this.tone); revOut.connect(this.tone);
    this.master = c.createGain();
    this.fade = c.createGain();
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.01; this.comp.release.value = 0.3;
    this.tone.connect(this.master).connect(this.fade).connect(this.comp);
    if (opts.analyse) { this.an = c.createAnalyser(); this.an.fftSize = 2048; this.an.smoothingTimeConstant = 0.7; this.comp.connect(this.an); this.an.connect(c.destination); }
    else this.comp.connect(c.destination);
    this.meters = !!opts.analyse;
    this.ch = {};
    this.mix = null;
  }
  /* ---- 共用小積木 ---- */
  src(kind, t, stop, offset) {
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[kind]; s.loop = true;
    s.start(t, offset != null ? offset : this.r() * 5.5); if (stop != null) s.stop(stop); return s;
  }
  filt(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  pan(v, dest) { if (!this.ctx.createStereoPanner) return dest; const p = this.ctx.createStereoPanner(); p.pan.value = clamp(v, -1, 1); p.connect(dest); return p; }
  // 短噪音爆裂（雨滴、劈啪、按鍵、時鐘）：用預先算好的立體聲樣本，每次只要 BufferSource＋Gain 兩個節點
  // （第一版每滴雨 4 個節點＋濾波器，離線合成 20 秒雨聲要 4.7 秒）
  burstBuf(f, d, q, pan) {
    const fb = Math.round(Math.log2(f / 400) * 3), db = d < 0.008 ? 0 : d < 0.02 ? 1 : d < 0.04 ? 2 : 3, qb = q < 1.2 ? 0 : q < 3 ? 1 : 2, pb = Math.round(clamp(pan, -1, 1) * 2);
    const key = fb + '|' + db + '|' + qb + '|' + pb;
    this.bank = this.bank || {};
    if (this.bank[key]) return this.bank[key];
    const sr = this.ctx.sampleRate, fc = 400 * Math.pow(2, fb / 3), dd = [0.005, 0.014, 0.03, 0.05][db], qq = [0.8, 2, 6][qb], pp = pb / 2;
    const len = Math.ceil(sr * (dd + 0.03)), b = this.ctx.createBuffer(2, len, sr), r = rng(fb * 131 + db * 17 + qb * 7 + 3);
    // RBJ 帶通（常數 0dB 峰值）
    const w0 = 2 * Math.PI * Math.min(fc, sr * 0.45) / sr, al = Math.sin(w0) / (2 * qq), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
    const mono = new Float32Array(len); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, pk = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr, env = tt < 0.001 ? tt / 0.001 : Math.exp(-(tt - 0.001) / (dd / 3));
      const x = (r() * 2 - 1) * env, y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; mono[i] = y; pk = Math.max(pk, Math.abs(y));
    }
    const gl = Math.cos((pp + 1) * Math.PI / 4) / (pk || 1), gr = Math.sin((pp + 1) * Math.PI / 4) / (pk || 1);
    const L = b.getChannelData(0), R = b.getChannelData(1);
    for (let i = 0; i < len; i++) { L[i] = mono[i] * gl * 0.7; R[i] = mono[i] * gr * 0.7; }
    return (this.bank[key] = b);
  }
  burst(dest, t, d, f, q, g, pan) {
    const s = this.ctx.createBufferSource(); s.buffer = this.burstBuf(f, d, q, pan);
    s.playbackRate.value = f / (400 * Math.pow(2, Math.round(Math.log2(f / 400) * 3) / 3));
    const e = this.ctx.createGain(); e.gain.value = g;
    s.connect(e).connect(dest); s.start(t);
  }
  tone1(dest, t, f, d, g, type = 'sine', pan = 0, f1) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d);
    const e = this.ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(g, t + Math.min(0.008, d / 3)); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(e).connect(this.pan(pan, dest)); o.start(t); o.stop(t + d + 0.02);
  }

  /* ---- 建立一軌 ---- */
  ensure(id) {
    if (this.ch[id]) return this.ch[id];
    const c = this.ctx, k = { id, state: {}, dstate: {}, until: 0 };
    k.pre = c.createGain();
    k.drift = c.createGain();
    k.lv = c.createGain(); k.lv.gain.value = 0;
    k.panner = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    k.mute = c.createGain(); k.mute.gain.value = 0;
    k.pre.connect(k.drift).connect(k.lv).connect(k.panner).connect(k.mute).connect(this.bus);
    k.send = this.gain(REV[id] || 0); k.mute.connect(k.send).connect(this.revIn);
    if (this.meters) { k.an = c.createAnalyser(); k.an.fftSize = 512; k.mute.connect(k.an); }
    const t = c.currentTime, P = k.pre;
    // 連續的部分
    if (id === 'rain') {
      k.bedLp = this.filt('lowpass', 4000); k.bedG = this.gain(0.4);
      this.src('pink', t).connect(this.filt('highpass', 400)).connect(k.bedLp).connect(k.bedG).connect(P);
    } else if (id === 'waves') {
      this.src('brown', t).connect(this.filt('lowpass', 420)).connect(this.gain(0.18)).connect(P);
    } else if (id === 'wind') {
      this.src('brown', t).connect(this.filt('lowpass', 320)).connect(k.bedG = this.gain(0.25)).connect(P);
    } else if (id === 'fire') {
      this.src('brown', t).connect(this.filt('lowpass', 240)).connect(this.gain(0.35)).connect(P);
      this.src('pink', t).connect(this.filt('bandpass', 700, 0.8)).connect(k.bedG = this.gain(0.06)).connect(P);
    } else if (id === 'stream') {
      k.bands = [[480, 2], [1300, 3], [3200, 4]].map(([f, q]) => { const g = this.gain(0.2); this.src('white', t).connect(this.filt('bandpass', f, q)).connect(g).connect(P); return g; });
      this.src('pink', t).connect(this.filt('lowpass', 900)).connect(k.bedG = this.gain(0.2)).connect(P);
    } else if (id === 'cafe') {
      this.src('brown', t).connect(this.filt('lowpass', 650)).connect(this.gain(0.22)).connect(P);
      this.src('pink', t).connect(this.filt('bandpass', 1500, 0.6)).connect(this.gain(0.035)).connect(P);
      k.room = this.filt('lowpass', 2200); k.room.connect(P);
    } else if (id === 'noise') {
      k.ng = ['white', 'pink', 'brown'].map(n => { const g = this.gain(0); this.src(n, t).connect(g).connect(P); return g; });
    } else if (id === 'pad') {
      k.lp = this.filt('lowpass', 900, 0.6); k.lp.connect(P);
    } else if (id === 'crickets' || id === 'birds' || id === 'typing' || id === 'clock' || id === 'thunder') {
      // 純事件軌
    }
    this.ch[id] = k;
    return k;
  }

  /* ---- 套用混音設定 ---- */
  apply(mix, ramp = 0.06) {
    this.mix = mix;
    const t = this.ctx.currentTime, set = (p, v) => (ramp ? p.setTargetAtTime(v, t, ramp) : p.setValueAtTime(v, t));
    const live = new Set(activeIds(mix));
    CHANNELS.forEach(c => {
      const s = mix.ch[c.id];
      if (!s.on && !this.ch[c.id]) return;
      const k = this.ensure(c.id);
      if (live.has(c.id) && !k.wasLive) k.until = Math.max(k.until, t + 0.03);
      k.wasLive = live.has(c.id);
      set(k.lv.gain, CAL[c.id] * Math.pow(s.lv, 1.7));
      set(k.mute.gain, live.has(c.id) ? 1 : 0);
      if (k.panner.pan) set(k.panner.pan, s.pan);
      if (!mix.drift) set(k.drift.gain, 1);
      this.setChar(k, s.ch, set);
    });
    set(this.tone.frequency, 900 * Math.pow(20, mix.tone));
    set(this.master.gain, Math.pow(mix.master, 1.6));
  }
  setChar(k, x, set) {
    k.k = x;
    if (k.id === 'rain') { set(k.bedLp.frequency, 1500 + 5500 * x); set(k.bedG.gain, 0.22 + 0.5 * x); }
    if (k.id === 'wind') set(k.bedG.gain, 0.12 + 0.35 * x);
    if (k.id === 'fire') set(k.bedG.gain, 0.03 + 0.08 * x);
    if (k.id === 'stream') set(k.bedG.gain, 0.12 + 0.25 * x);
    if (k.id === 'noise') {   // 白 → 粉紅 → 棕
      const w = x < 0.5 ? 1 - x * 2 : 0, p = x < 0.5 ? x * 2 : 2 - x * 2, b = x > 0.5 ? x * 2 - 1 : 0;
      set(k.ng[0].gain, w * 0.45); set(k.ng[1].gain, p * 0.9); set(k.ng[2].gain, b * 0.6);
    }
    if (k.id === 'pad') set(k.lp.frequency, 300 + 2600 * x * x);
  }

  /* ---- 排程聲音事件到 t1 ---- */
  schedule(t1) {
    if (!this.mix) return;
    const live = activeIds(this.mix);
    live.forEach(id => {
      const k = this.ensure(id), t0 = Math.max(k.until, this.ctx.currentTime);
      if (t1 <= t0) return;
      this.events(k, t0, t1);
      if (this.mix.drift) GEN.drift(t0, t1, 0, this.r, k.dstate).forEach(e => k.drift.gain.setTargetAtTime(e.g, e.t, e.tau));
      k.until = t1;
    });
  }
  events(k, t0, t1) {
    const r = this.r, x = k.k != null ? k.k : 0.5, P = k.pre, id = k.id;
    if (id === 'rain') GEN.rain(t0, t1, x, r).forEach(e => this.burst(P, e.t, e.d, e.f, 2.5, e.g * 0.55, e.pan));
    else if (id === 'thunder') GEN.thunder(t0, t1, x, r).forEach(e => {
      const end = e.t + e.rise + e.dur, s = this.src('brown', e.t, end + 0.2), lp = this.filt('lowpass', e.f, 0.7), g = this.ctx.createGain();
      lp.frequency.setValueAtTime(e.f * 1.6, e.t); lp.frequency.exponentialRampToValueAtTime(e.f * 0.6, end);
      g.gain.setValueAtTime(0.0001, e.t); g.gain.exponentialRampToValueAtTime(e.g, e.t + e.rise); g.gain.exponentialRampToValueAtTime(0.0001, end);
      s.connect(lp).connect(g).connect(this.pan(e.pan, P));
      if (e.dist < 0.4) {   // 近雷的劈裂聲（較長，不用樣本庫）
        const s2 = this.src('white', e.t, e.t + 0.8), h = this.filt('highpass', 900, 0.5), g2 = this.ctx.createGain();
        g2.gain.setValueAtTime(0.0001, e.t); g2.gain.linearRampToValueAtTime((0.4 - e.dist) * 1.4, e.t + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, e.t + 0.7);
        s2.connect(h).connect(g2).connect(this.pan(e.pan, P));
      }
    });
    else if (id === 'waves') GEN.waves(t0, t1, x, r, k.state).forEach(e => {
      const end = e.t + e.rise + e.fall, s = this.src('pink', e.t, end + 0.1), lp = this.filt('lowpass', 300, 0.5), g = this.ctx.createGain();
      lp.frequency.setValueAtTime(300, e.t); lp.frequency.linearRampToValueAtTime(e.bright, e.t + e.rise); lp.frequency.exponentialRampToValueAtTime(350, end);
      g.gain.setValueAtTime(0.0001, e.t); g.gain.linearRampToValueAtTime(e.g * 0.9, e.t + e.rise); g.gain.exponentialRampToValueAtTime(0.0001, end);
      s.connect(lp).connect(g).connect(this.pan(e.pan, P));
    });
    else if (id === 'wind') GEN.wind(t0, t1, x, r, k.state).forEach(e => {
      const end = e.t + e.dur, s = this.src(r() < 0.5 ? 'pink' : 'brown', e.t, end + 0.1), bp = this.filt('bandpass', e.f, 1.1), g = this.ctx.createGain();
      bp.frequency.setValueAtTime(e.f * 0.8, e.t); bp.frequency.linearRampToValueAtTime(e.f * 1.35, e.t + e.dur * 0.5); bp.frequency.linearRampToValueAtTime(e.f * 0.9, end);
      g.gain.setValueAtTime(0.0001, e.t); g.gain.linearRampToValueAtTime(e.g * (0.5 + 0.5 * x), e.t + e.dur * 0.45); g.gain.linearRampToValueAtTime(0.0001, end);
      s.connect(bp).connect(g).connect(this.pan(e.pan, P));
    });
    else if (id === 'fire') GEN.fire(t0, t1, x, r).forEach(e => this.burst(P, e.t, e.d, e.f, e.big ? 0.9 : 1.6, e.g * 0.7, e.pan));
    else if (id === 'stream') GEN.stream(t0, t1, x, r, k.state).forEach(e => k.bands.forEach((b, i) => b.gain.setTargetAtTime(e.g[i] * [0.45, 0.35, 0.22][i] * (0.55 + 0.7 * x), e.t, 0.03)));
    else if (id === 'birds') GEN.birds(t0, t1, x, r).forEach(e => this.tone1(P, e.t, e.f0, e.d, e.g * 0.16, 'sine', e.pan, e.f1));
    else if (id === 'crickets') GEN.crickets(t0, t1, x, r, k.state).forEach(e => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = e.f;
      g.gain.setValueAtTime(0, e.t);
      for (let i = 0; i < e.pulses; i++) { const a = e.t + i * 0.034; g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(e.g * 0.07, a + 0.004); g.gain.setValueAtTime(e.g * 0.07, a + 0.014); g.gain.linearRampToValueAtTime(0, a + 0.02); }
      o.connect(g).connect(this.pan(e.pan, P)); o.start(e.t); o.stop(e.t + e.pulses * 0.034 + 0.05);
    });
    else if (id === 'cafe') {
      const ev = GEN.cafe(t0, t1, x, r, k.state);
      // 每位客人一條固定的聲音鏈，音節只改參數（同一人的音節不重疊，所以包絡事件依時間排好）
      k.voices = k.voices || [];
      ev.syl.forEach(e => {
        let v = k.voices[e.voice];
        if (!v) { v = k.voices[e.voice] = { bp: this.filt('bandpass', e.f, 3), g: this.gain(0) }; this.src('pink', this.ctx.currentTime).connect(v.bp).connect(v.g).connect(this.pan(e.pan, k.room)); }
        v.bp.frequency.setValueAtTime(e.f, e.t);
        v.g.gain.setValueAtTime(0, e.t); v.g.gain.linearRampToValueAtTime(e.g * 0.5, e.t + Math.min(0.03, e.d * 0.3)); v.g.gain.setValueAtTime(e.g * 0.5, e.t + e.d * 0.6); v.g.gain.linearRampToValueAtTime(0, e.t + e.d);
      });
      ev.clinks.forEach(e => { this.tone1(P, e.t, e.f, e.d, e.g * 0.05, 'sine', e.pan); this.tone1(P, e.t, e.f * 2.71, e.d * 0.6, e.g * 0.025, 'sine', e.pan); });
    }
    else if (id === 'typing') GEN.typing(t0, t1, x, r, k.state).forEach(e => {
      if (e.kind === 'key') { this.burst(P, e.t, 0.008, e.f, 2, e.g * 0.45, e.pan); this.tone1(P, e.t, 150, 0.025, e.g * 0.12, 'sine', e.pan); }
      else { this.burst(P, e.t, 0.025, e.f, 1, e.kind === 'enter' ? 0.7 : 0.5, e.pan); this.tone1(P, e.t, 105, 0.04, 0.2, 'sine', e.pan); }
    });
    else if (id === 'clock') GEN.clock(t0, t1, x, r, k.state).forEach(e => { this.burst(P, e.t, 0.004, e.f, 9, e.hi ? 0.9 : 0.65, 0); this.tone1(P, e.t, e.f * 0.5, 0.03, 0.05, 'sine'); });
    else if (id === 'pad') GEN.pad(t0, t1, x, r, k.state).forEach(e => {
      const rel = 4.5, end = e.t + e.dur + rel;
      e.notes.forEach((m, i) => {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        [['triangle', 0], ['sine', 5]].forEach(([type, det]) => {
          const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det + (i % 2 ? -3 : 3);
          const g = this.ctx.createGain(); const peak = type === 'sine' ? 0.035 : 0.05;
          g.gain.setValueAtTime(0, e.t); g.gain.linearRampToValueAtTime(peak, e.t + 3.5); g.gain.setValueAtTime(peak, e.t + e.dur); g.gain.linearRampToValueAtTime(0, end);
          o.connect(g).connect(this.pan((i - 1.5) * 0.3, k.lp)); o.start(e.t); o.stop(end + 0.05);
        });
      });
    });
  }

  /* ---- 其他 ---- */
  fadeTo(v, sec) { const t = this.ctx.currentTime; this.fade.gain.cancelScheduledValues(t); this.fade.gain.setValueAtTime(this.fade.gain.value, t); this.fade.gain.linearRampToValueAtTime(v, t + sec); }
  chime(n = 2) {   // 番茄鐘提示：兩聲柔和鐘聲，直接到輸出（不受主推桿影響）
    const c = this.ctx, t = c.currentTime + 0.05;
    [[880, 0], [1318.5, 0.45], [880, 0.9]].slice(0, n + 1).forEach(([f, dt]) => {
      [[1, 0.18], [2.76, 0.05], [5.4, 0.02]].forEach(([h, g]) => {
        const o = c.createOscillator(), e = c.createGain(); o.frequency.value = f * h;
        e.gain.setValueAtTime(0.0001, t + dt); e.gain.linearRampToValueAtTime(g, t + dt + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + dt + 2.2);
        o.connect(e).connect(this.comp); o.start(t + dt); o.stop(t + dt + 2.3);
      });
    });
  }
  level(an) {   // 0～1 的 RMS（給電平燈）
    if (!an) return 0;
    const a = this._tmp && this._tmp.length === an.fftSize ? this._tmp : (this._tmp = new Float32Array(an.fftSize));
    an.getFloatTimeDomainData(a);
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / a.length);
  }
}
