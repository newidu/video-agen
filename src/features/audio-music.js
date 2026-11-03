/* Music, beat detection, audio and sound-effect features. Extracted from original/source.html lines 2019-2527. */
/* ============================================================
   MUSIC & BEAT — a track on the timeline, a BPM, a beat grid,
   and beatPulse()/beatEnv(t) for animations and scene code.
   ============================================================ */
const MUSIC = {
  name: '', dataUrl: '', bpm: 120, offset: 0, volume: 0.8,
  fadeIn: 0.3, fadeOut: 0.6, loop: true, grid: true, dur: 0, on: true
};
window.MUSIC = MUSIC;

function musicDur() { return MUSIC.dur || DUR; }
function musicVolAt(t) {
  if (MUSIC.on === false) return 0;
  let v = MUSIC.volume;
  if (MUSIC.fadeIn > 0) v *= clamp(t / MUSIC.fadeIn, 0, 1);
  if (MUSIC.fadeOut > 0) v *= clamp((DUR - t) / MUSIC.fadeOut, 0, 1);
  return clamp(v, 0, 1);
}
function hookMusicAudio() {
  ensureAudio();
  if (!actx) return;
  if (!audioEl.src && MUSIC.dataUrl) audioEl.src = MUSIC.dataUrl;
  try {
    if (srcNode) srcNode.disconnect();
  } catch (e) {}
  if (audioEl.src) {
    try {
      if (!srcNode) srcNode = actx.createMediaElementSource(audioEl);
      srcNode.connect(actx.destination);
    } catch (e) {
      try { srcNode = actx.createMediaElementSource(audioEl); srcNode.connect(actx.destination); } catch (e2) {}
    }
  }
  audioEl.loop = !!MUSIC.loop;
  audioEl.volume = MUSIC.volume;
  audioEl.muted = MUSIC.on === false;
}
let APPLYING_MUSIC = false;
function applyMusic(silent) {
  /* syncSpec() re-applies the music, and applyMusic() calls syncSpec() —
     without this guard the two recurse into each other and freeze the tab */
  if (APPLYING_MUSIC) return;
  APPLYING_MUSIC = true; window.__APPLYING_MUSIC__ = true;
  try { applyMusicInner(silent); } finally { APPLYING_MUSIC = false; window.__APPLYING_MUSIC__ = false; }
}
function applyMusicInner(silent) {
  setBeat(MUSIC.bpm, MUSIC.offset);          // helper clock used by every animation
  if (MUSIC.dataUrl) { audioEl.src = MUSIC.dataUrl; audioEl.loop = !!MUSIC.loop; }
  audioEl.volume = MUSIC.volume;
  SPEC.music = MUSIC.name || MUSIC.dataUrl || MUSIC.bpm !== 120 || MUSIC.on === false
    ? { name: MUSIC.name, bpm: MUSIC.bpm, offset: MUSIC.offset, volume: MUSIC.volume,
        fadeIn: MUSIC.fadeIn, fadeOut: MUSIC.fadeOut, loop: MUSIC.loop, dur: MUSIC.dur, on: MUSIC.on,
        dataUrl: MUSIC.dataUrl || undefined }
    : undefined;
  drawBeats(); renderMusicBox();
  try { setMusicOn(MUSIC.on !== false); } catch (e) {} syncSpec();
  if (!silent) refresh();
}
function setMusic(cfg) {
  cfg = cfg || {};
  if (cfg.clear) {
    MUSIC.name = ''; MUSIC.dataUrl = ''; MUSIC.dur = 0;
    try { audioEl.pause(); } catch (e) {}
    audioEl.removeAttribute('src'); try { audioEl.load(); } catch (e) {}
    try { if (srcNode) srcNode.disconnect(); } catch (e) {}
    srcNode = null;
  }
  ['bpm', 'offset', 'volume', 'fadeIn', 'fadeOut'].forEach(k => {
    if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') MUSIC[k] = +(+cfg[k]).toFixed(3);
  });
  if (cfg.loop !== undefined) MUSIC.loop = !!cfg.loop;
  if (cfg.grid !== undefined) MUSIC.grid = !!cfg.grid;
  if (cfg.name !== undefined) MUSIC.name = String(cfg.name);
  if (cfg.dataUrl !== undefined) MUSIC.dataUrl = String(cfg.dataUrl);
  applyMusic();
  return musicStatus();
}
function musicStatus() {
  return {
    track: MUSIC.name || (MUSIC.dataUrl ? 'embedded track' : 'none'),
    bpm: MUSIC.bpm, offset: MUSIC.offset, volume: MUSIC.volume,
    fadeIn: MUSIC.fadeIn, fadeOut: MUSIC.fadeOut,
    length: +(MUSIC.dur || 0).toFixed(2) || null,
    beats: beatList(12).length, beatTimes: beatList(12)
  };
}
function beatList(limit) {
  const out = [];
  const n = Math.ceil((DUR - MUSIC.offset) / B);
  for (let i = 0; i < n && out.length < (limit || 9999); i++) {
    const t = MUSIC.offset + i * B;
    if (t >= 0 && t <= DUR) out.push(+t.toFixed(3));
  }
  return out;
}
function beatMap() {
  const beats = beatList(9999);
  const cuts = SCENES.map(s => ({ scene: s.id, name: s.name, in: +s.in.toFixed(2), out: +s.out.toFixed(2), beat: beats.findIndex(b => b >= s.in - 0.001) + 1 }));
  return { bpm: MUSIC.bpm, beat: +B.toFixed(4), offset: MUSIC.offset, count: beats.length, beats, scenes: cuts };
}

/* ---------- BPM detection (energy autocorrelation) ---------- */
async function decodeAudio(dataUrl) {
  const buf = await (await fetch(dataUrl)).arrayBuffer();
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ac = new Ctor(1, 44100, 44100);
  return await ac.decodeAudioData(buf.slice(0));
}
async function detectBpm() {
  if (!MUSIC.dataUrl) return null;
  const audio = await decodeAudio(MUSIC.dataUrl);
  const data = audio.getChannelData(0);
  const sr = audio.sampleRate, hop = Math.floor(sr * 0.01);         // 10 ms frames
  const env = [];
  for (let i = 0; i + hop < data.length; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j += 4) { const v = data[i + j]; e += v * v; }
    env.push(Math.sqrt(e / (hop / 4)));
  }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] || 0)));
  let best = { bpm: MUSIC.bpm, score: -1 };
  for (let bpm = 60; bpm <= 190; bpm++) {
    const lag = Math.round((60 / bpm) / 0.01);
    if (lag < 2 || lag >= flux.length) continue;
    let s = 0;
    for (let i = lag; i < flux.length; i++) s += flux[i] * flux[i - lag];
    s /= (flux.length - lag);
    if (s > best.score) best = { bpm, score: s, lag };
  }
  let offset = 0;
  for (let i = 1; i < Math.min(flux.length, 400); i++) if (flux[i] > flux[i - 1] * 1.6 && flux[i] > 0.02) { offset = i * 0.01; break; }
  MUSIC.bpm = best.bpm; MUSIC.offset = +offset.toFixed(2); MUSIC.dur = +audio.duration.toFixed(2);
  applyMusic();
  return { bpm: MUSIC.bpm, offset: MUSIC.offset };
}

/* ---------- make a beat without any file (kick / hat / bass) ---------- */
function wavDataUrl(buffer) {
  const n = buffer.length, sr = buffer.sampleRate;
  const ch = Math.min(2, buffer.numberOfChannels);
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); wr(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  wr(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
  }
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(bin);
}
async function makeBeat(cfg) {
  cfg = cfg || {};
  const bpm = clamp(+(cfg.bpm || MUSIC.bpm || 120), 40, 240);
  const style = (cfg.style || 'pop').toLowerCase();
  const len = Math.max(2, Math.min(120, +(cfg.duration || DUR || 8)));
  const sr = 44100, spb = 60 / bpm, beats = Math.ceil(len / spb);
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Ctor(2, Math.ceil(len * sr), sr);
  const master = off.createGain(); master.gain.value = 0.55; master.connect(off.destination);
  const kick = (t0) => {
    const o = off.createOscillator(), g = off.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(44, t0 + 0.13);
    g.gain.setValueAtTime(0.9, t0); g.gain.exponentialRampToValueAtTime(0.0012, t0 + 0.34);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.36);
  };
  const hat = (t0, amp) => {
    const n = off.sampleRate * 0.06, buffer = off.createBuffer(1, n, off.sampleRate), d = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const src = off.createBufferSource(), hp = off.createBiquadFilter(), g = off.createGain();
    src.buffer = buffer; hp.type = 'highpass'; hp.frequency.value = 7000; g.gain.value = amp;
    src.connect(hp); hp.connect(g); g.connect(master); src.start(t0);
  };
  const bass = (t0, freq, dur) => {
    const o = off.createOscillator(), g = off.createGain(), lp = off.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = freq; lp.type = 'lowpass'; lp.frequency.value = 320;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  const prog = [55, 55, 73.4, 65.4];
  for (let i = 0; i < beats; i++) {
    const t = i * spb;
    const every = style === 'house' ? 1 : 1;
    if (i % every === 0) kick(t);
    if (style === 'house') hat(t + spb / 2, 0.22);
    else { hat(t + spb * 0.5, 0.16); if (i % 2 === 1) hat(t + spb * 0.75, 0.1); }
    if (style !== 'minimal') bass(t + spb * 0.5, prog[Math.floor(i / 4) % prog.length], spb * 0.45);
  }
  const rendered = await off.startRendering();
  MUSIC.dataUrl = wavDataUrl(rendered);
  MUSIC.name = 'generated ' + style + ' beat · ' + Math.round(bpm) + ' BPM';
  MUSIC.bpm = Math.round(bpm); MUSIC.dur = +len.toFixed(2); MUSIC.offset = 0;
  hookMusicAudio();
  applyMusic();
  return musicStatus();
}

/* ---------- beat ruler ---------- */
function drawBeats() {
  const c = document.getElementById('beatbar');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 600, h = 14;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0d1218'; g.fillRect(0, 0, w, h);
  if (!DUR) return;
  const x = t => (t / DUR) * w;
  // scene boundaries
  SCENES.forEach(s => { g.fillStyle = '#25303d'; g.fillRect(Math.round(x(s.in)), 0, 1, h); });
  if (MUSIC.grid && (MUSIC.dataUrl || MUSIC.bpm !== 120)) {
    beatList(9999).forEach((t, i) => {
      const bar = i % 4 === 0;
      g.fillStyle = bar ? '#22c3a6' : '#3c4b5d';
      g.fillRect(Math.round(x(t)), bar ? 1 : 5, bar ? 2 : 1, bar ? h - 2 : h - 8);
    });
  }
  // playhead
  const px = Math.round(x(time));
  g.fillStyle = '#ffffff'; g.fillRect(px, 0, 2, h);
}

/* ---------- music panel wiring ---------- */
function renderMusicBox() {
  const box = document.getElementById('musicBox');
  if (box) box.classList.toggle('musicOff', MUSIC.on === false);
  const set = (id, v) => { const el = document.getElementById(id); if (el && el !== document.activeElement) el.value = v; };
  const nm = document.getElementById('musName');
  if (nm) nm.textContent = MUSIC.name || (MUSIC.dataUrl ? 'embedded track' : 'none');
  set('musBpm', MUSIC.bpm); set('musOffset', MUSIC.offset); set('musVol', MUSIC.volume);
  set('musIn', MUSIC.fadeIn); set('musOut', MUSIC.fadeOut);
  const grid = document.getElementById('musGrid');
  if (grid) grid.checked = !!MUSIC.grid;
  const info = document.getElementById('musInfo');
  if (info) info.innerHTML = (MUSIC.dataUrl
    ? 'Track loaded' + (MUSIC.dur ? ' · ' + MUSIC.dur.toFixed(1) + 's' : '') + ' · ' + Math.round(MUSIC.bpm) + ' BPM'
    : 'No track yet — add a music file, or let the agent make one.')
    + '. Beats drive <b>anim:"beat"</b> and <code>beatEnv(t)</code> in scene code.';
}
function toggleMusicBox(force) {
  const box = document.getElementById('musicBox');
  if (!box) return;
  const on = force === undefined ? !box.classList.contains('on') : !!force;
  box.classList.toggle('on', on);
  document.getElementById('btnMusic').classList.toggle('primary', on);
  if (on) { renderMusicBox(); drawBeats(); }
}
(function wireMusic() {
  const btn = document.getElementById('btnMusic');
  if (btn) btn.onclick = () => toggleMusicBox();
  const pick = document.getElementById('musPick');
  const fin = document.getElementById('musicIn');
  if (pick && fin) pick.onclick = () => fin.click();
  if (fin) fin.onchange = async () => {
    const f = fin.files && fin.files[0];
    if (!f) return;
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
    MUSIC.dataUrl = dataUrl; MUSIC.name = f.name; MUSIC.volume = 0.8;
    try {
      const a = await decodeAudio(dataUrl);
      MUSIC.dur = +a.duration.toFixed(2);
    } catch (e) { MUSIC.dur = 0; }
    hookMusicAudio();
    applyMusic();
    document.getElementById('status').textContent = 'Music: ' + f.name + (MUSIC.dur ? ' · ' + MUSIC.dur.toFixed(1) + 's' : '') + ' — press detect to find the BPM.';
    fin.value = '';
  };
  const gen = document.getElementById('musGen');
  if (gen) gen.onclick = async () => {
    gen.disabled = true; gen.textContent = '… making';
    try { await makeBeat({ bpm: MUSIC.bpm, style: 'pop', duration: Math.max(4, Math.ceil(DUR)) }); }
    catch (e) { document.getElementById('status').textContent = 'Could not make a beat: ' + e.message; }
    gen.disabled = false; gen.textContent = '✨ Make a beat';
  };
  const clr = document.getElementById('musClear');
  if (clr) clr.onclick = () => { setMusic({ clear: true }); document.getElementById('status').textContent = 'Music removed.'; };
  const det = document.getElementById('musDetect');
  if (det) det.onclick = async () => {
    det.disabled = true; det.textContent = '…';
    try {
      const r = await detectBpm();
      document.getElementById('status').textContent = r ? 'Detected ' + r.bpm + ' BPM (offset ' + r.offset + 's).' : 'Add a music file first.';
    } catch (e) { document.getElementById('status').textContent = 'BPM detect failed: ' + e.message; }
    det.disabled = false; det.textContent = 'detect';
  };
  const live = { musBpm: 'bpm', musOffset: 'offset', musVol: 'volume', musIn: 'fadeIn', musOut: 'fadeOut' };
  Object.keys(live).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { MUSIC[live[id]] = +el.value; applyMusic(); };
  });
  const grid = document.getElementById('musGrid');
  if (grid) grid.onchange = () => { MUSIC.grid = grid.checked; drawBeats(); };
  const fbtn = document.getElementById('btnFont');
  const ffin = document.getElementById('fontIn');
  if (fbtn && ffin) fbtn.onclick = () => ffin.click();
  if (ffin) ffin.onchange = async () => {
    const f = ffin.files && ffin.files[0];
    if (f) {
      const name = await addFontFile(f);
      document.getElementById('status').textContent = 'Font “' + name + '” added — pick it in the Font row of the element panel.';
    }
    ffin.value = '';
  };
})();


/* ============================================================
   SOUND DESIGN — music on/off, plus a library of synthesised
   SFX the agent (or the human) places on the timeline. Every
   sound has its own on/off switch and is mixed into the export.
   ============================================================ */
const SFX_TYPES = ['pop', 'click', 'whoosh', 'ding', 'riser', 'boom', 'tik', 'chime', 'swipe'];
const SFX = [];                       // {id, type, t, gain, on}
window.SFX = SFX;
window.SFX_TYPES = SFX_TYPES;
let sfxBuffs = {};
let sfxBus = null;

function sfxBusNode() {
  if (!actx) return null;
  if (!sfxBus) { sfxBus = actx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(actx.destination); }
  return sfxBus;
}
async function synthSfx(type) {
  const sr = 44100;
  const lens = { pop: 0.16, click: 0.09, whoosh: 0.42, ding: 0.7, riser: 0.8, boom: 0.75, tik: 0.06, chime: 1.1, swipe: 0.3 };
  const len = Math.ceil((lens[type] || 0.3) * sr);
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Ctor(2, len, sr);
  const g = off.createGain(); g.connect(off.destination);
  const noise = (dur) => {
    const n = Math.ceil(dur * sr), b = off.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = off.createBufferSource(); src.buffer = b; return src;
  };
  const tone = (f0, f1, dur, shape, amp) => {
    const o = off.createOscillator(), gg = off.createGain();
    o.type = shape || 'sine';
    o.frequency.setValueAtTime(f0, 0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, dur);
    gg.gain.setValueAtTime(0.0001, 0);
    gg.gain.exponentialRampToValueAtTime(amp, Math.min(0.03, dur * 0.2));
    gg.gain.exponentialRampToValueAtTime(0.0001, dur);
    o.connect(gg); gg.connect(g); o.start(0); o.stop(dur + 0.02);
  };
  if (type === 'pop') { tone(620, 180, 0.15, 'sine', 0.55); tone(1200, 700, 0.06, 'triangle', 0.18); }
  else if (type === 'click') { tone(2400, 1400, 0.05, 'square', 0.14); }
  else if (type === 'tik') { const s = noise(0.05); const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000; const gg = off.createGain(); gg.gain.setValueAtTime(0.35, 0); gg.gain.exponentialRampToValueAtTime(0.0001, 0.05); s.connect(hp); hp.connect(gg); gg.connect(g); s.start(0); }
  else if (type === 'whoosh' || type === 'swipe') {
    const s = noise(type === 'whoosh' ? 0.4 : 0.28), bp = off.createBiquadFilter(), gg = off.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(type === 'whoosh' ? 320 : 900, 0);
    bp.frequency.exponentialRampToValueAtTime(type === 'whoosh' ? 3800 : 2600, type === 'whoosh' ? 0.36 : 0.24);
    gg.gain.setValueAtTime(0.0001, 0); gg.gain.exponentialRampToValueAtTime(0.5, 0.06);
    gg.gain.exponentialRampToValueAtTime(0.0001, type === 'whoosh' ? 0.4 : 0.28);
    s.connect(bp); bp.connect(gg); gg.connect(g); s.start(0);
  }
  else if (type === 'ding') { tone(1046, 0, 0.65, 'sine', 0.4); tone(1568, 0, 0.5, 'sine', 0.22); }
  else if (type === 'chime') { tone(880, 0, 1.05, 'sine', 0.3); tone(1320, 0, 0.9, 'sine', 0.18); tone(1760, 0, 0.7, 'sine', 0.1); }
  else if (type === 'riser') { tone(180, 1400, 0.75, 'sawtooth', 0.16); }
  else if (type === 'boom') { tone(110, 38, 0.7, 'sine', 0.7); }
  return await off.startRendering();
}
async function ensureSfxBuffers() {
  const missing = SFX_TYPES.filter(t => !sfxBuffs[t]);
  if (!missing.length) return;
  for (const t of missing) { try { sfxBuffs[t] = await synthSfx(t); } catch (e) { console.warn('sfx synth', t, e); } }
}
function playSfx(type, gain) {
  ensureAudio();
  if (!actx) return;
  ensureSfxBuffers().then(() => {
    const buf = sfxBuffs[type];
    if (!buf || !actx) return;
    const s = actx.createBufferSource(), g2 = actx.createGain();
    s.buffer = buf; g2.gain.value = clamp(gain === undefined ? 0.6 : gain, 0, 1);
    s.connect(g2); g2.connect(sfxBusNode());
    try { s.start(); } catch (e) {}
  });
}
/* fire everything that should have sounded between two frame times */
function sfxTick(tPrev, tNow) {
  if (!SFX.length) return;
  const a = Math.min(tPrev, tNow), b = Math.max(tPrev, tNow);
  SFX.forEach(s => {
    if (s.on === false) return;
    if (s.t > a && s.t <= b) playSfx(s.type, s.gain);
  });
}
function applySfx(silent) {
  SPEC.sfx = SFX.length ? SFX.map(s => ({ id: s.id, type: s.type, t: +(+s.t).toFixed(3), gain: s.gain, on: s.on !== false })) : undefined;
  renderSfxList();
  if (!silent) refresh();
}
function addSfx(type, t, gain) {
  const id = 'fx' + (SFX.length + 1) + '_' + Math.random().toString(36).slice(2, 6);
  const s = { id, type: SFX_TYPES.indexOf(type) >= 0 ? type : 'pop', t: Math.max(0, Math.min(DUR - 0.01, +t || 0)), gain: gain === undefined ? 0.6 : +gain, on: true };
  SFX.push(s);
  SFX.sort((x, y) => x.t - y.t);
  applySfx();
  return s;
}
function clearSfx() { SFX.length = 0; applySfx(); }
function toggleSfx(id, on) {
  const s = SFX.find(x => x.id === id);
  if (!s) return null;
  s.on = on === undefined ? s.on === false : !!on;
  applySfx();
  return s;
}
/* one call makes a whole soundtrack bed: a tick on each scene cut and a
   pop/swoosh for the first animation of every scene */
function autoSfx(opts) {
  opts = opts || {};
  const before = SFX.length;
  SFX.length = 0;
  SCENES.forEach((sc, i) => {
    if (i > 0) addSfxSilent('whoosh', sc.in, 0.45);
    const animated = (sc.spec.elements || []).filter(el => el.anim && el.anim !== 'none');
    if (animated.length) {
      animated.slice(0, 3).forEach(el => {
        const kind = el.anim === 'fade' ? 'swipe' : el.anim === 'beat' ? 'tik' : 'pop';
        addSfxSilent(kind, sc.in + (el.delay || 0) + 0.02, 0.5);
      });
    } else {
      addSfxSilent(i === 0 ? 'pop' : 'swipe', sc.in + 0.02, 0.45);   // always give the cut a sound
    }
    if (opts.beat && window.MUSIC && MUSIC.dataUrl) addSfxSilent('tik', sc.in, 0.25);
  });
  applySfx();
  return SFX.length - before;
}
function addSfxSilent(type, t, gain) {
  SFX.push({ id: 'fx' + (SFX.length + 1) + '_a', type: SFX_TYPES.indexOf(type) >= 0 ? type : 'pop',
    t: Math.max(0, Math.min(DUR - 0.01, +t || 0)), gain: gain === undefined ? 0.6 : +gain, on: true });
  SFX.sort((x, y) => x.t - y.t);
  return SFX[SFX.length - 1];
}
function renderSfxList() {
  const box = document.getElementById('sfxList');
  if (!box) return;
  if (!SFX.length) { box.innerHTML = '<p class="muted2">No sound effects yet — “Auto SFX” places a whoosh on every cut and a pop on the first animation.</p>'; return; }
  box.innerHTML = SFX.map(s => `
    <div class="sfxRow" data-id="${s.id}">
      <input type="checkbox" class="fxOn" ${s.on === false ? '' : 'checked'} title="on / off">
      <b>${s.type}</b><span class="fxT">${s.t.toFixed(2)}s</span>
      <button class="tiny fxPlay" title="preview">♪</button>
      <button class="tiny fxDel" title="remove">✕</button>
    </div>`).join('');
  box.querySelectorAll('.sfxRow').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.fxOn').onchange = e => toggleSfx(id, e.target.checked);
    row.querySelector('.fxPlay').onclick = () => { const s = SFX.find(x => x.id === id); if (s) { ensureSfxBuffers().then(() => playSfx(s.type, s.gain)); } };
    row.querySelector('.fxDel').onclick = () => { const i = SFX.findIndex(x => x.id === id); if (i >= 0) SFX.splice(i, 1); applySfx(); };
  });
}
/* music on/off */
function setMusicOn(on) {
  MUSIC.on = !!on;
  audioEl.muted = !MUSIC.on;
  if (!MUSIC.on) { try { audioEl.pause(); } catch (e) {} }
  applyMusic(true);
  /* music OFF hides the music-creation tools — in the panel and for the agent */
  const box = document.getElementById('musicBox');
  if (box) box.classList.toggle('musicOff', !MUSIC.on);
  renderMusicBox();
  const btn = document.getElementById('btnMusicOn');
  if (btn) { btn.textContent = MUSIC.on ? '🔊 Music ON' : '🔇 Music OFF'; btn.classList.toggle('primary', !!MUSIC.on); }
  try { drawBeats(); } catch (e) {}
  return MUSIC.on;
}
window.SFX_API = {
  add: addSfx, list: () => SFX.map(s => ({ id: s.id, type: s.type, t: +s.t.toFixed(2), gain: s.gain, on: s.on !== false })),
  toggle: toggleSfx, clear: clearSfx, auto: autoSfx, play: playSfx, types: SFX_TYPES,
  musicOn: setMusicOn, musicIsOn: () => MUSIC.on !== false
};
(function wireSfx() {
  const auto = document.getElementById('sfxAuto');
  if (auto) auto.onclick = () => { const n = autoSfx({ beat: true }); document.getElementById('status').textContent = n + ' sound effect(s) placed — every row has its own on/off.'; };
  const clr = document.getElementById('sfxClear');
  if (clr) clr.onclick = () => { clearSfx(); document.getElementById('status').textContent = 'Sound effects cleared.'; };
  const mOn = document.getElementById('musOn');
  if (mOn) mOn.onchange = () => setMusicOn(mOn.checked);
  const bOn = document.getElementById('btnMusicOn');
  if (bOn) bOn.onclick = () => { setMusicOn(MUSIC.on === false ? true : false); };
})();

/* fonts + music for the agent */
window.MUSIC_API = {
  set: setMusic, make: makeBeat, detect: detectBpm, status: musicStatus, map: beatMap,
  isOn: () => MUSIC.on !== false, setOn: (v) => setMusicOn(v),
  fonts: fontNames, addFont: registerFont, setFont: setFontOf,
  get music() { return MUSIC; }
};


