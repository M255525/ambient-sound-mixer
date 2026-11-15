// node tools/test_engine.mjs
import * as E from '../engine.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
ok(E.CHANNELS.length === 13 && new Set(E.CHANNELS.map(c => c.id)).size === 13, '13 軌');
// 每個產生器：時間落在區間內、排序、密度合理；分段呼叫與一次呼叫事件數相近（狀態延續）
for (const id of Object.keys(E.GEN)) {
  for (const k of [0, 0.5, 1]) {
    const r = E.rng(42), st = {};
    let ev = E.GEN[id](0, 60, k, r, st);
    if (id === 'cafe') ev = [...ev.syl, ...ev.clinks].sort((a, b) => a.t - b.t);
    ok(ev.every(e => e.t >= 0 && e.t < (id === 'birds' ? 62 : 60)), `${id} k=${k} 時間在區間內`);   // 鳥鳴一段可延續到區間外
    ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t - 1e-9) || id === 'cafe', `${id} 排序`);
    ok(ev.every(e => Object.values(e).every(v => typeof v !== 'number' || Number.isFinite(v))), `${id} 無 NaN`);
    const perSec = ev.length / 60;
    if (id !== 'thunder' && id !== 'pad' && id !== 'drift') ok(perSec > 0.05, `${id} k=${k} 有事件 ${perSec}`);
    ok(perSec < 120, `${id} k=${k} 密度上限 ${perSec.toFixed(1)}/s`);
    // 分 4 段排程（模擬即時排程）
    const r2 = E.rng(42), st2 = {};
    let n2 = 0;
    for (let t = 0; t < 60; t += 1.2) { const e2 = E.GEN[id](t, Math.min(60, t + 1.2), k, r2, st2); n2 += id === 'cafe' ? e2.syl.length + e2.clinks.length : e2.length; }
    if (['waves', 'wind', 'stream', 'crickets', 'typing', 'clock', 'pad', 'drift'].includes(id)) ok(Math.abs(n2 - ev.length) <= Math.max(3, ev.length * 0.1), `${id} k=${k} 分段排程不重複不漏 ${n2} vs ${ev.length}`);
  }
}
// 旋鈕方向：k 越大越密
const cnt = (id, k) => { const e = E.GEN[id](0, 120, k, E.rng(7), {}); return id === 'cafe' ? e.syl.length : e.length; };
for (const id of ['rain', 'thunder', 'fire', 'birds', 'crickets', 'typing', 'cafe']) ok(cnt(id, 1) > cnt(id, 0), `${id} 旋鈕越大越多 ${cnt(id, 0)}→${cnt(id, 1)}`);
ok(cnt('waves', 1) > cnt('waves', 0), '浪越洶湧越密');
ok(E.GEN.clock(0, 10, 0.5, E.rng(1), {}).length === 10, '時鐘每秒一下');
// 預設
ok(E.PRESETS.length === 8 && E.PRESETS.every(p => E.activeIds(p.mix).length >= 2), '8 組預設都有 2 軌以上');
// 混音清洗
const bad = E.cleanMix({ ch: { rain: { on: 1, lv: 9, ch: -3, pan: 'x' }, nope: { on: true } }, master: 5, tone: null });
ok(bad.ch.rain.on === true && bad.ch.rain.lv === 1 && bad.ch.rain.ch === 0 && bad.ch.rain.pan === 0 && bad.master === 1 && bad.tone === 0.6 && !bad.ch.nope, 'cleanMix 夾範圍 ' + JSON.stringify(bad.ch.rain));
ok(E.cleanMix(null).ch.rain.on === false, 'cleanMix 壞資料');
// 獨奏與靜音
const m = E.mixFrom({ rain: {}, fire: { s: true }, wind: { m: true } });
ok(JSON.stringify(E.activeIds(m)) === '["fire"]', '獨奏只剩 fire');
m.ch.fire.s = false; ok(JSON.stringify(E.activeIds(m)) === '["rain","fire"]', '靜音排除 wind');
// 分享
const p = E.PRESETS[1].mix, enc = E.encodeShare(E.compactMix(p));
ok(/^[A-Za-z0-9_-]+$/.test(enc) && enc.length < 400, '分享網址短 ' + enc.length);
ok(JSON.stringify(E.activeIds(E.cleanMix(E.decodeShare(enc)))) === JSON.stringify(E.activeIds(p)), '分享來回');
ok(E.decodeShare('!!') === null, '壞分享');
// 番茄鐘
let q = E.pomodoro(0); ok(q.phase === 'work' && q.round === 1 && q.left === 1500, '番茄開始');
q = E.pomodoro(1500 + 10); ok(q.phase === 'rest' && q.left === 290, '短休');
q = E.pomodoro(3 * 1800 + 1500 + 1); ok(q.phase === 'long' && q.round === 4, '第 4 輪長休 ' + JSON.stringify(q));
q = E.pomodoro(3 * 1800 + 1500 + 900 + 1); ok(q.phase === 'work' && q.round === 5, '第 5 輪');
ok(E.fmtTime(3725) === '1:02:05' && E.fmtTime(65) === '1:05', 'fmtTime');
// 無縫循環：輸出長度、接縫連續
const sr = 1000, N = 5000, xf = 1;
const sig = new Float32Array(N + sr * xf).map((_, i) => Math.sin(i / 37));
const [lp] = E.makeLoop([sig], sr, xf);
ok(lp.length === N, '循環長度');
ok(Math.abs(lp[0] - sig[N]) < 1e-6, '開頭接得上原本的尾巴');
ok(Math.abs(lp[N - 1] - sig[N - 1]) < 1e-6, '結尾不變');
// WAV
const w = E.encodeWAV([new Float32Array(100), new Float32Array(100)], 44100);
ok(w.length === 44 + 400 && String.fromCharCode(...w.slice(0, 4)) === 'RIFF', 'WAV');
console.log(`通過 ${pass}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
