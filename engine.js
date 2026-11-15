// 環境音混音桌 — 純函式引擎（瀏覽器與 Node 共用，不碰 DOM／Web Audio）
// 聲音全部是程式合成：這裡負責「什麼時候發生什麼聲音事件」與資料格式；實際發聲在 synth.js。

/* ---------- 亂數 ---------- */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const rr = (r, a, b) => a + r() * (b - a);
// 卜瓦松過程：在 [t0,t1) 內依每秒 rate 產生事件時間
export function poisson(t0, t1, rate, r) {
  const out = [];
  if (!(rate > 0)) return out;
  let t = t0 - Math.log(1 - r()) / rate;
  while (t < t1) { out.push(t); t += -Math.log(1 - r()) / rate; }
  return out;
}

/* ---------- 音軌定義 ---------- */
// ch：特性旋鈕 0～1 的意義；def：預設 { lv 音量 0～1, ch 特性, pan -1～1 }
export const CHANNELS = [
  { id: 'rain', icon: '🌧️', name: '雨聲', knob: '雨勢', lo: '毛毛雨', hi: '大雨', def: { lv: 0.6, ch: 0.45, pan: 0 } },
  { id: 'thunder', icon: '⛈️', name: '雷聲', knob: '頻率', lo: '偶爾', hi: '頻繁', def: { lv: 0.5, ch: 0.35, pan: 0 } },
  { id: 'waves', icon: '🌊', name: '海浪', knob: '浪況', lo: '平靜', hi: '洶湧', def: { lv: 0.6, ch: 0.4, pan: 0 } },
  { id: 'wind', icon: '💨', name: '風聲', knob: '風力', lo: '微風', hi: '強風', def: { lv: 0.45, ch: 0.35, pan: 0 } },
  { id: 'fire', icon: '🔥', name: '營火', knob: '劈啪', lo: '悶燒', hi: '旺火', def: { lv: 0.55, ch: 0.45, pan: 0 } },
  { id: 'stream', icon: '🏞️', name: '溪流', knob: '水量', lo: '涓涓', hi: '湍急', def: { lv: 0.5, ch: 0.45, pan: 0 } },
  { id: 'birds', icon: '🐦', name: '鳥鳴', knob: '鳥群', lo: '零星', hi: '熱鬧', def: { lv: 0.4, ch: 0.35, pan: 0 } },
  { id: 'crickets', icon: '🦗', name: '蟲鳴', knob: '蟲數', lo: '一兩隻', hi: '滿山', def: { lv: 0.35, ch: 0.4, pan: 0 } },
  { id: 'cafe', icon: '☕', name: '咖啡廳', knob: '人潮', lo: '冷清', hi: '客滿', def: { lv: 0.5, ch: 0.45, pan: 0 } },
  { id: 'typing', icon: '⌨️', name: '打字聲', knob: '速度', lo: '慢慢想', hi: '飛快', def: { lv: 0.4, ch: 0.45, pan: 0.2 } },
  { id: 'clock', icon: '🕰️', name: '時鐘', knob: '音色', lo: '木頭', hi: '金屬', def: { lv: 0.3, ch: 0.4, pan: -0.3 } },
  { id: 'noise', icon: '📻', name: '噪音', knob: '色彩', lo: '白', hi: '棕', def: { lv: 0.4, ch: 0.7, pan: 0 } },
  { id: 'pad', icon: '🎹', name: '柔和和弦', knob: '亮度', lo: '暗', hi: '亮', def: { lv: 0.35, ch: 0.35, pan: 0 } },
];
export const CH = Object.fromEntries(CHANNELS.map(c => [c.id, c]));

/* ---------- 混音資料 ---------- */
export function defaultMix() {
  const ch = {};
  CHANNELS.forEach(c => { ch[c.id] = { on: false, lv: c.def.lv, ch: c.def.ch, pan: c.def.pan, m: false, s: false }; });
  return { v: 1, ch, master: 0.8, tone: 0.6, drift: true };
}
export function mixFrom(parts, extra = {}) {
  const m = defaultMix();
  Object.entries(parts).forEach(([id, p]) => { if (m.ch[id]) Object.assign(m.ch[id], { on: true }, p); });
  return Object.assign(m, extra);
}
export const PRESETS = [
  { id: 'study', name: '📚 讀書專注', desc: '細雨＋棕色噪音＋遠處時鐘，蓋掉環境雜音又不搶注意力', mix: mixFrom({ rain: { lv: 0.45, ch: 0.3 }, noise: { lv: 0.35, ch: 0.85 }, clock: { lv: 0.18, ch: 0.25 } }, { tone: 0.5 }) },
  { id: 'rainycafe', name: '☕ 雨天咖啡廳', desc: '窗外下雨、店裡小聲聊天和杯盤聲', mix: mixFrom({ rain: { lv: 0.5, ch: 0.5, pan: -0.2 }, cafe: { lv: 0.5, ch: 0.45 }, pad: { lv: 0.2, ch: 0.3 } }) },
  { id: 'campfire', name: '🏕️ 夜晚營火', desc: '營火劈啪、蟲鳴、微風', mix: mixFrom({ fire: { lv: 0.65, ch: 0.5 }, crickets: { lv: 0.3, ch: 0.45 }, wind: { lv: 0.25, ch: 0.2 } }) },
  { id: 'beach', name: '🌊 海邊午後', desc: '海浪拍岸、海風、遠處的鳥', mix: mixFrom({ waves: { lv: 0.7, ch: 0.45 }, wind: { lv: 0.3, ch: 0.35 }, birds: { lv: 0.18, ch: 0.2, pan: 0.4 } }) },
  { id: 'forest', name: '🌲 森林溪谷', desc: '溪水、鳥鳴、樹梢的風', mix: mixFrom({ stream: { lv: 0.55, ch: 0.45 }, birds: { lv: 0.4, ch: 0.5 }, wind: { lv: 0.2, ch: 0.25 } }) },
  { id: 'sleep', name: '😴 好眠', desc: '低沉的棕色噪音＋很輕的雨＋暗暗的和弦，配合睡眠定時', mix: mixFrom({ noise: { lv: 0.45, ch: 1 }, rain: { lv: 0.25, ch: 0.2 }, pad: { lv: 0.18, ch: 0.1 } }, { tone: 0.3 }) },
  { id: 'storm', name: '⛈️ 雷雨夜', desc: '大雨、遠雷、強風', mix: mixFrom({ rain: { lv: 0.7, ch: 0.85 }, thunder: { lv: 0.6, ch: 0.45 }, wind: { lv: 0.35, ch: 0.6 } }) },
  { id: 'coding', name: '💻 深夜寫程式', desc: '鍵盤聲、窗外小雨、低低的和弦', mix: mixFrom({ typing: { lv: 0.35, ch: 0.5 }, rain: { lv: 0.35, ch: 0.35 }, pad: { lv: 0.25, ch: 0.4 }, noise: { lv: 0.15, ch: 0.9 } }) },
];

export function validMix(m) {
  return !!(m && typeof m === 'object' && m.ch && typeof m.ch === 'object');
}
// 讀入任何來源的混音（分享連結、localStorage）都要先清洗
export function cleanMix(m) {
  const out = defaultMix();
  if (!validMix(m)) return out;
  const num = (v, a, b, d) => (v != null && v !== '' && Number.isFinite(+v) ? clamp(+v, a, b) : d);
  CHANNELS.forEach(c => {
    const s = m.ch[c.id]; if (!s) return;
    const d = out.ch[c.id];
    out.ch[c.id] = { on: !!s.on, lv: num(s.lv, 0, 1, d.lv), ch: num(s.ch, 0, 1, d.ch), pan: num(s.pan, -1, 1, d.pan), m: !!s.m, s: !!s.s };
  });
  out.master = num(m.master, 0, 1, out.master);
  out.tone = num(m.tone, 0, 1, out.tone);
  out.drift = m.drift !== false;
  return out;
}
export function activeIds(mix) {
  const anySolo = CHANNELS.some(c => mix.ch[c.id].on && mix.ch[c.id].s);
  return CHANNELS.filter(c => { const s = mix.ch[c.id]; return s.on && !s.m && (!anySolo || s.s); }).map(c => c.id);
}
export function describeMix(mix) {
  const ids = activeIds(mix);
  return ids.length ? ids.map(id => CH[id].icon + CH[id].name).join('＋') : '（全部關閉）';
}

/* ---------- 分享 ---------- */
export function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeShare(s) {
  try {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch (e) { return null; }
}
// 分享只帶開啟的軌，縮短網址
export function compactMix(mix) {
  const ch = {};
  CHANNELS.forEach(c => { const s = mix.ch[c.id]; if (s.on) ch[c.id] = { on: true, lv: +s.lv.toFixed(2), ch: +s.ch.toFixed(2), pan: +s.pan.toFixed(2), ...(s.m ? { m: true } : {}), ...(s.s ? { s: true } : {}) }; });
  return { v: 1, ch, master: +mix.master.toFixed(2), tone: +mix.tone.toFixed(2), drift: mix.drift };
}

/* ---------- 事件產生器（[t0,t1) 內；k＝特性旋鈕 0～1） ---------- */
export const GEN = {
  // 雨滴：每秒 8～45 滴
  rain(t0, t1, k, r) {
    return poisson(t0, t1, lerp(8, 45, k), r).map(t => ({ t, f: rr(r, 1800, 6500), g: rr(r, 0.15, 1) * lerp(0.6, 1, k), d: rr(r, 0.006, 0.025), pan: rr(r, -0.9, 0.9) }));
  },
  // 雷：平均每 45～8 秒一次；dist 0 近 1 遠
  thunder(t0, t1, k, r) {
    return poisson(t0, t1, lerp(1 / 45, 1 / 8, k), r).map(t => { const dist = rr(r, 0.2, 1); return { t, dist, rise: lerp(0.08, 1.2, dist), dur: rr(r, 3, 7) + dist * 2, g: lerp(1, 0.45, dist), f: lerp(420, 140, dist), pan: rr(r, -0.6, 0.6) }; });
  },
  // 海浪：每道浪間隔 11～5 秒
  waves(t0, t1, k, r, state) {
    const out = []; state.next = state.next == null ? t0 + rr(r, 0, 2) : state.next;
    while (state.next < t1) {
      const per = lerp(11, 5, k) * rr(r, 0.75, 1.3);
      if (state.next >= t0) out.push({ t: state.next, rise: per * rr(r, 0.35, 0.5), fall: per * rr(r, 0.55, 0.8), g: rr(r, 0.55, 1) * lerp(0.7, 1, k), bright: lerp(900, 2600, k) * rr(r, 0.8, 1.2), pan: rr(r, -0.35, 0.35) });
      state.next += per;
    }
    return out;
  },
  // 風：陣風
  wind(t0, t1, k, r, state) {
    const out = []; state.next = state.next == null ? t0 : state.next;
    while (state.next < t1) {
      const dur = rr(r, 3, 9) * lerp(1.2, 0.7, k);
      if (state.next >= t0) out.push({ t: state.next, dur, g: rr(r, 0.4, 1), f: rr(r, 250, 500) * lerp(0.8, 2, k), pan: rr(r, -0.5, 0.5) });
      state.next += dur * rr(r, 0.6, 1.1);
    }
    return out;
  },
  // 營火劈啪：每秒 2～22 下，偶爾大爆裂
  fire(t0, t1, k, r) {
    return poisson(t0, t1, lerp(2, 22, k), r).map(t => { const big = r() < 0.08; return { t, big, f: big ? rr(r, 600, 1400) : rr(r, 1500, 5000), g: big ? rr(r, 0.6, 1) : rr(r, 0.1, 0.6), d: big ? rr(r, 0.02, 0.05) : rr(r, 0.002, 0.012), pan: rr(r, -0.5, 0.5) }; });
  },
  // 溪流：三個頻帶各自快速起伏（每 60～140ms 換一次目標）
  stream(t0, t1, k, r, state) {
    const out = []; state.next = state.next == null ? t0 : state.next;
    while (state.next < t1) {
      if (state.next >= t0) out.push({ t: state.next, g: [rr(r, 0.2, 1), rr(r, 0.1, 1), rr(r, 0, 1) * lerp(0.4, 1, k)] });
      state.next += rr(r, 0.06, 0.14);
    }
    return out;
  },
  // 鳥鳴：每秒 0.08～0.9 段，每段 2～7 聲
  birds(t0, t1, k, r) {
    const out = [];
    poisson(t0, t1, lerp(0.08, 0.9, k), r).forEach(t => {
      const sp = Math.floor(r() * 4), n = 2 + Math.floor(r() * 6), base = rr(r, 2200, 4800), pan = rr(r, -0.9, 0.9), g = rr(r, 0.35, 1);
      let tt = t;
      for (let i = 0; i < n; i++) {
        let f0, f1, d;
        if (sp === 0) { f0 = base * 1.25; f1 = base * 0.8; d = rr(r, 0.08, 0.16); }        // 下滑哨音
        else if (sp === 1) { f0 = base; f1 = base * 1.15; d = rr(r, 0.025, 0.045); }       // 快速顫音
        else if (sp === 2) { f0 = i % 2 ? base * 0.84 : base; f1 = f0; d = rr(r, 0.1, 0.18); } // 兩音交替
        else { f0 = base * 0.9; f1 = base * 1.4; d = rr(r, 0.05, 0.1); }                   // 上揚
        out.push({ t: tt, f0, f1, d, g: g * rr(r, 0.7, 1), pan });
        tt += d + (sp === 1 ? rr(r, 0.01, 0.025) : rr(r, 0.04, 0.12));
      }
    });
    return out.sort((a, b) => a.t - b.t);
  },
  // 蟲鳴：每隻蟲固定音高與節奏，chirp＝3～4 個短脈衝
  crickets(t0, t1, k, r, state) {
    const n = Math.round(lerp(1, 7, k));
    if (!state.bugs || state.bugs.length !== n) state.bugs = Array.from({ length: n }, (_, i) => ({ f: rr(r, 3900, 5200), per: rr(r, 0.38, 0.75), pulses: 3 + (r() < 0.5 ? 1 : 0), pan: n === 1 ? 0 : -0.85 + 1.7 * i / (n - 1), next: t0 + rr(r, 0, 0.7), g: rr(r, 0.4, 1) }));
    const out = [];
    state.bugs.forEach(b => {
      while (b.next < t1) {
        if (b.next >= t0 && r() > 0.06) out.push({ t: b.next, f: b.f, pulses: b.pulses, g: b.g, pan: b.pan });
        b.next += b.per * rr(r, 0.92, 1.08);
      }
    });
    return out.sort((a, b) => a.t - b.t);
  },
  // 咖啡廳：音節（人聲共振頻帶跳動）＋杯盤聲
  cafe(t0, t1, k, r, state) {
    const voices = Math.round(lerp(3, 10, k));
    if (!state.v || state.v.length !== voices) state.v = Array.from({ length: voices }, () => ({ next: t0 + rr(r, 0, 2), talking: r() < 0.5, base: rr(r, 280, 700), pan: rr(r, -0.8, 0.8), g: rr(r, 0.3, 1) }));
    const syl = [], clinks = [];
    state.v.forEach((v, vi) => {
      while (v.next < t1) {
        if (v.talking) {
          const d = rr(r, 0.09, 0.24);
          if (v.next >= t0) syl.push({ t: v.next, d, f: v.base * rr(r, 0.75, 1.6), g: v.g * rr(r, 0.5, 1), pan: v.pan, voice: vi });
          v.next += d + rr(r, 0.01, 0.08);
          if (r() < 0.06) v.talking = false;
        } else { v.next += rr(r, 0.8, 4); v.talking = true; }
      }
    });
    poisson(t0, t1, lerp(0.08, 0.6, k), r).forEach(t => clinks.push({ t, f: rr(r, 2400, 4600), g: rr(r, 0.2, 0.7), d: rr(r, 0.25, 0.8), pan: rr(r, -0.8, 0.8) }));
    return { syl: syl.sort((a, b) => a.t - b.t), clinks };
  },
  // 打字：一個字 2～8 鍵、字間空白鍵、偶爾停下來想
  typing(t0, t1, k, r, state) {
    // 一次只產生一個按鍵，「這個字還剩幾鍵」記在 state，分段排程才不會把字切斷
    const out = []; state.next = state.next == null ? t0 + 0.2 : state.next;
    const cps = lerp(3.5, 11, k);
    while (state.next < t1) {
      if (!state.left) state.left = 2 + Math.floor(r() * 7);
      if (state.left > 0) {
        if (state.next >= t0) out.push({ t: state.next, kind: 'key', g: rr(r, 0.5, 1), f: rr(r, 1800, 3800), pan: rr(r, -0.25, 0.25) });
        state.next += (1 / cps) * rr(r, 0.6, 1.5);
        state.left--;
        if (state.left === 0) state.left = -1;   // 下一個是空白鍵
      } else {
        if (state.next >= t0) out.push({ t: state.next, kind: r() < 0.08 ? 'enter' : 'space', g: 1, f: 900, pan: 0.1 });
        state.next += (1 / cps) * rr(r, 1, 1.8) + (r() < lerp(0.12, 0.05, k) ? rr(r, 1.5, 5) : 0);
        state.left = 0;
      }
    }
    return out;
  },
  // 時鐘：每秒一下，滴、答交替
  clock(t0, t1, k, r, state) {
    const out = []; state.next = state.next == null ? Math.ceil(t0) : state.next;
    state.i = state.i || 0;
    while (state.next < t1) {
      if (state.next >= t0) out.push({ t: state.next, hi: state.i % 2 === 0, f: lerp(1600, 4200, k) * (state.i % 2 ? 0.82 : 1) });
      state.next += 1; state.i++;
    }
    return out;
  },
  // 和弦：每 10～16 秒換一個（C 大調柔和進行，音高用 MIDI）
  pad(t0, t1, k, r, state) {
    const CHORDS = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 62], [40, 47, 55, 62], [41, 48, 55, 64]];
    const out = []; state.next = state.next == null ? t0 : state.next;
    state.ci = state.ci == null ? 0 : state.ci;
    while (state.next < t1) {
      const dur = rr(r, 10, 16);
      if (state.next >= t0) out.push({ t: state.next, dur, notes: CHORDS[state.ci % CHORDS.length] });
      state.next += dur; state.ci += r() < 0.75 ? 1 : 2;
    }
    return out;
  },
  // 自然變化：每 4～9 秒換一個音量倍率目標（0.75～1.1）
  drift(t0, t1, k, r, state) {
    const out = []; state.next = state.next == null ? t0 : state.next;
    while (state.next < t1) { if (state.next >= t0) out.push({ t: state.next, g: rr(r, 0.75, 1.1), tau: rr(r, 1.5, 3.5) }); state.next += rr(r, 4, 9); }
    return out;
  },
};

/* ---------- 計時 ---------- */
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
// 番茄鐘：給已經過的秒數，回傳目前階段
export function pomodoro(elapsed, work = 25, rest = 5, longRest = 15, every = 4) {
  const W = work * 60, R = rest * 60, L = longRest * 60;
  let t = elapsed, round = 1;
  for (let guard = 0; guard < 1000; guard++) {
    if (t < W) return { phase: 'work', round, left: W - t, total: W };
    t -= W;
    const br = round % every === 0 ? L : R;
    if (t < br) return { phase: round % every === 0 ? 'long' : 'rest', round, left: br - t, total: br };
    t -= br; round++;
  }
  return { phase: 'work', round, left: W, total: W };
}

/* ---------- 匯出 ---------- */
// 無縫循環：把多錄的 xf 秒尾巴用等功率交叉淡化疊回開頭，輸出長度 = 全長 - xf
export function makeLoop(chans, sr, xfSec) {
  const xf = Math.floor(sr * xfSec), len = chans[0].length - xf;
  return chans.map(c => {
    const o = new Float32Array(len);
    o.set(c.subarray(0, len));
    for (let i = 0; i < xf; i++) { const a = i / xf; o[i] = c[i] * Math.sin(a * Math.PI / 2) + c[len + i] * Math.cos(a * Math.PI / 2); }
    return o;
  });
}
export function normalize(chans, target = 0.89) {
  let peak = 0;
  chans.forEach(c => { for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; } });
  const g = peak > 0 ? target / peak : 1;
  chans.forEach(c => { for (let i = 0; i < c.length; i++) c[i] *= g; });
  return { peak, gain: g };
}
export function encodeWAV(chans, sr) {
  const n = chans.length, len = chans[0].length;
  const buf = new ArrayBuffer(44 + len * n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, n, true); v.setUint32(24, sr, true); v.setUint32(28, sr * n * 2, true); v.setUint16(32, n * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * n * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < n; c++) { const s = clamp(chans[c][i], -1, 1); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(buf);
}
