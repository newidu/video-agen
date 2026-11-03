/* Selection, crop, playback, panels, export, project persistence and input wiring. Extracted from original/source.html lines 971-1966. */
/* ============================================================
   Editor UI — select / drag / edit / delete / export
   ============================================================ */
const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
let DUR = 15;   // set by buildScenes() from the spec

const LABELS = new Proxy({}, { get: (t, k) => (window.LABELMAP || {})[k] });
const isLetterId = id => String(id).indexOf('#') >= 0;
const parentOf = id => String(id).split('#')[0];
const letterIdx = id => +String(id).split('#')[1];
function glyphChar(id) {                       // works even for hidden glyphs (not drawn any more)
  const dm = DRAWN[id] || {};
  if (dm.char) return dm.char;
  const it = EDIT.items[id] || {};
  if (it.char !== undefined && it.char !== null && it.char !== '') return String(it.char);
  const p = EDIT.items[parentOf(id)] || {};
  const base = p.text !== undefined ? p.text : (p.label !== undefined ? p.label : '');
  return textUnits(String(base))[letterIdx(id)] || '?';   // grapheme clusters for Sinhala/Tamil/…
}
const labelOf = id => {
  if (isLetterId(id)) {
    return (LABELS[parentOf(id)] || parentOf(id)) + ' · letter “' + glyphChar(id) + '” #' + (letterIdx(id) + 1);
  }
  const it = EDIT.items[id];
  if (LABELS[id]) return LABELS[id];
  if (it && it.label) return it.label;
  return id;
};


/* ---- geometry: how much of a hit quad falls inside the crop rectangle ---- */
function clipPolyRect(poly, r) {
  const clipEdge = (pts, inside, cross) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ai = inside(a), bi = inside(b);
      if (ai) out.push(a);
      if (ai !== bi) out.push(cross(a, b));
    }
    return out;
  };
  const ix = (a, b, x) => { const t = (x - a[0]) / (b[0] - a[0] || 1e-9); return [x, a[1] + t * (b[1] - a[1])]; };
  const iy = (a, b, y) => { const t = (y - a[1]) / (b[1] - a[1] || 1e-9); return [a[0] + t * (b[0] - a[0]), y]; };
  let p = poly;
  p = clipEdge(p, q => q[0] >= r.x, (a, b) => ix(a, b, r.x));
  if (p.length < 3) return 0;
  p = clipEdge(p, q => q[0] <= r.x + r.w, (a, b) => ix(a, b, r.x + r.w));
  if (p.length < 3) return 0;
  p = clipEdge(p, q => q[1] >= r.y, (a, b) => iy(a, b, r.y));
  if (p.length < 3) return 0;
  p = clipEdge(p, q => q[1] <= r.y + r.h, (a, b) => iy(a, b, r.y + r.h));
  if (p.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
function quadArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
/* which real elements / glyphs live under the box?
   glyphs and elements that are (mostly) inside are removed for real,
   so they stay gone even while the scene animates.                     */
function findVictims(r) {
  const prev = LETTER_MODE;
  LETTER_MODE = true; renderFrame(time);            // make sure glyph boxes exist
  const glyphs = [], glyphTotal = {}, cover = {};
  let best = null, bestF = 0;
  HITS.forEach(h => {
    const tot = quadArea(h.q);
    if (tot <= 1) return;
    const f = clipPolyRect(h.q, r) / tot;
    if (isLetterId(h.id)) {
      const p = parentOf(h.id);
      glyphTotal[p] = (glyphTotal[p] || 0) + 1;
      if (f >= 0.5) glyphs.push(h.id);
    } else {
      if (f > (cover[h.id] || 0)) cover[h.id] = f;
      if (f > bestF && f > 0.08) { bestF = f; best = h.id; }
    }
  });
  LETTER_MODE = prev; renderFrame(time);

  const hide = [], carve = [], carveIds = [];
  Object.keys(cover).forEach(id => {
    const f = cover[id];
    const it = EDIT.items[id] || {};
    if (glyphTotal[id]) {                                  // a text element
      const cov = glyphs.filter(x => parentOf(x) === id).length;
      if (cov === glyphTotal[id]) hide.push(id);            // every letter covered -> whole text goes
      return;                                               // partially covered -> glyph removal only
    }
    if (it.img) return;                                     // crop pieces are handled by their panel
    if (f >= 0.85) hide.push(id);                           // basically fully inside the box -> remove
    else if (f >= 0.08) { carve.push({ it: itm(id), id: id }); carveIds.push(id); }  // cut a hole that travels with it
  });

  // a carved hole must not be added to something that is being removed anyway
  const carveFinal = carve.filter(c => hide.indexOf(c.id) < 0);
  const glyphFinal = glyphs.filter(x => hide.indexOf(parentOf(x)) < 0);

  // erasing letters must not punch a hole in the bubble/card that holds them
  if (glyphFinal.length) carveFinal.length = 0;
  if (!hide.length && !glyphFinal.length && !carveFinal.length && best) hide.push(best);
  return { glyphs: glyphFinal, groups: hide, carve: carveFinal, carveIds: carveIds };
}
function hideVictims(v) {
  const ids = v.groups.concat(v.glyphs);
  ids.forEach(id => { const it = itm(id); it.hidden = true; });
  // cut the box out of whatever shape it only partly covered
  const rect = CROP.pending;
  (v.carve || []).forEach(pair => {
    const it = pair.it, id = pair.id;
    if (!rect || !it) return;
    const off = (typeof partOffset === 'function') ? partOffset(id) : { x: it.dx || 0, y: it.dy || 0 };
    it.erases = it.erases || [];
    it.erases.push({ x: rect.x - off.x, y: rect.y - off.y, w: rect.w, h: rect.h });
  });
  return ids;
}

/* ---------------- cut-out / erase tool ---------------- */
const CROP = { armed: false, drag: null, pending: null };
function syncCropBtn() {
  const b = document.getElementById('btnCrop');
  if (b) { b.textContent = CROP.armed ? '✂️ Drag…' : '✂️ Cut / erase'; b.classList.toggle('primary', CROP.armed); }
  document.getElementById('stageInner').style.cursor = CROP.armed ? 'crosshair' : '';
}
function armCrop(on) {
  CROP.armed = on === undefined ? !CROP.armed : !!on;
  CROP.drag = null;
  if (!CROP.armed) CROP.pending = null;
  hideChooser(); syncCropBtn();
  document.getElementById('status').textContent = CROP.armed
    ? 'Crop mode: drag a box over the part you want to cut out or erase.'
    : '';
  drawOverlay();
}
function hideChooser() { document.getElementById('cropPick').classList.remove('on'); }
function showChooser(rect) {
  const el = document.getElementById('cropPick');
  const r = stage.getBoundingClientRect();
  const k = r.width / stage.width;
  el.style.left = 'auto'; el.style.right = '10px';
  el.style.top = Math.max(8, Math.min(r.height - 150, rect.y * k)) + 'px';
  el.classList.add('on');
}
function cropRect() {
  const d = CROP.drag;
  if (!d) return null;
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
function makeCrop(mode) {
  const r = CROP.pending;
  if (!r || r.w < 16 || r.h < 16) { armCrop(false); return; }

  // freeze the pixels first, while the frame still shows them
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    c.getContext('2d').drawImage(stage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    url = c.toDataURL('image/png');
  } catch (err) { console.warn('crop capture', err); }

  // then remove the real elements / glyphs that were under the box
  const victims = findVictims(r);
  const removed = hideVictims(victims);
  const didAnything = removed.length > 0 || (victims.carve || []).length > 0;
  const status = document.getElementById('status');
  const names = removed.map(labelOf).join(', ');

  if (mode === 'erase' && didAnything) {
    CROP.pending = null; armCrop(false);
    SELECTED = null; refresh(); renderPanel(); renderItems();
    status.textContent = (removed.length
        ? 'Removed ' + removed.length + ' item' + (removed.length > 1 ? 's' : '') + ': ' + names.slice(0, 80)
        : 'Cut that piece out of the shape')
      + ((victims.carve || []).length ? ' + carved ' + victims.carve.length + ' hole' + (victims.carve.length > 1 ? 's' : '') : '')
      + ' — gone for the whole clip.';
    return;
  }

  const n = Object.keys(EDIT.items).filter(k => /^crop\d+$/.test(k)).length + 1;
  const id = 'crop' + n;
  const sc = SCENES.find(s => time >= s.in && time < s.out) || null;
  EDIT.items[id] = {
    dx: 0, dy: 0, hidden: false, img: url,
    x: r.x, y: r.y, w: r.w, h: r.h, scale: 1,
    piece: mode === 'cut',
    patch: !didAnything,                  // only paint background when nothing real was under the box
    dots: (typeof WASH === 'number' ? WASH : 0.1),
    t0: sc ? sc.in : 0, t1: sc ? sc.out : DUR,
    label: 'Crop ' + n + (mode === 'cut' ? ' · cut-out' : ' · erased area')
  };
  EDIT.base[id] = {};
  CROP.pending = null;
  armCrop(false);
  SELECTED = id;
  refresh(); renderPanel(); renderItems();
  status.textContent = mode === 'cut'
    ? 'Cut out — the original is removed for the whole clip' + (removed.length ? ' (' + names.slice(0, 60) + ')' : '') + '; drag the piece anywhere.'
    : 'Removed ' + (removed.length ? removed.length + ' item(s): ' + names.slice(0, 80) : 'the area') + ' — painted background only because nothing was registered there.';
}
/* ---------------- playback ---------------- */
let playing = false, time = 0, lastNow = 0;
const audioEl = document.getElementById('snd');
let actx = null, srcNode = null;
function ensureAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioEl && audioEl.src) {
      srcNode = actx.createMediaElementSource(audioEl);
      srcNode.connect(actx.destination);
    }
  } catch (e) { console.warn('audio graph', e); }
}
function setTime(t) {
  time = Math.max(0, Math.min(DUR - 0.0001, t));
  try { if (MUSIC && MUSIC.dataUrl) audioEl.volume = musicVolAt(time); } catch (e) {}
  try { drawBeats(); } catch (e) {}
  renderFrame(time);
  drawOverlay();
  document.getElementById('scrub').value = String(time);
  document.getElementById('clock').textContent = time.toFixed(2) + 's / ' + DUR.toFixed(2) + 's';
  renderElements();
  if (playing) { try { audioEl.currentTime = time; } catch (e) {} }
}
function loop(now) {
  if (!playing) return;
  const dt = lastNow ? (now - lastNow) / 1000 : 0;
  lastNow = now;
  const tPrev = time;
  let t = (audioEl.currentTime || (time + dt));
  if (t >= DUR) { t = 0; if (audioEl) { try { audioEl.currentTime = 0; } catch (e) {} } }
  time = t;
  try { sfxTick(tPrev, time); } catch (e) {}
  renderFrame(time);
  drawOverlay();
  document.getElementById('scrub').value = String(time);
  document.getElementById('clock').textContent = time.toFixed(2) + 's / ' + DUR.toFixed(2) + 's';
  requestAnimationFrame(loop);
}
function play() {
  ensureAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  playing = true; lastNow = 0;
  try { audioEl.currentTime = time; audioEl.play(); } catch (e) {}
  requestAnimationFrame(loop);
  syncPlayBtn();
}
function pause() {
  playing = false;
  try { audioEl.pause(); } catch (e) {}
  syncPlayBtn();
}
function syncPlayBtn() {
  document.getElementById('btnPlay').textContent = playing ? '❚❚  Pause' : '▶  Play';
}

/* ---------------- selection overlay ---------------- */
function drawOverlay() {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const band = cropRect() || CROP.pending;
  if (band && band.w > 0 && band.h > 0) {
    octx.save();
    octx.fillStyle = 'rgba(0,0,0,0.38)';
    octx.fillRect(0, 0, overlay.width, band.y);
    octx.fillRect(0, band.y + band.h, overlay.width, overlay.height - band.y - band.h);
    octx.fillRect(0, band.y, band.x, band.h);
    octx.fillRect(band.x + band.w, band.y, overlay.width - band.x - band.w, band.h);
    octx.strokeStyle = '#00E5A0'; octx.lineWidth = 6; octx.setLineDash([18, 12]);
    octx.strokeRect(band.x, band.y, band.w, band.h);
    octx.setLineDash([]);
    octx.fillStyle = '#00E5A0'; octx.font = '700 30px Baloo, sans-serif';
    octx.fillText(Math.round(band.w) + ' × ' + Math.round(band.h), band.x + 10, Math.max(34, band.y - 14));
    octx.restore();
  }
  if (!SELECTED) return;
  const hit = HITS.find(h => h.id === SELECTED);
  if (!hit) return;
  octx.save();
  octx.lineJoin = 'round';
  octx.strokeStyle = '#00E5A0';
  octx.lineWidth = 7;
  octx.setLineDash([16, 12]);
  octx.beginPath();
  hit.q.forEach((p, i) => (i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
  octx.closePath();
  octx.stroke();
  octx.setLineDash([]);
  octx.fillStyle = 'rgba(0,229,160,0.10)';
  octx.fill();
  // corner handles
  hit.q.forEach(p => {
    octx.fillStyle = '#00E5A0';
    octx.beginPath(); octx.arc(p[0], p[1], 13, 0, 7); octx.fill();
    octx.strokeStyle = '#06210f'; octx.lineWidth = 4; octx.stroke();
  });
  octx.restore();
}

/* ---------------- hit testing / drag ---------------- */
function toCanvas(ev) {
  const r = stage.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) * (stage.width / r.width),
    y: (ev.clientY - r.top) * (stage.height / r.height),
    scale: stage.width / r.width
  };
}
function inQuad(p, q) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const xi = q[i][0], yi = q[i][1], xj = q[j][0], yj = q[j][1];
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pick(p) {
  for (let i = HITS.length - 1; i >= 0; i--) if (inQuad(p, HITS[i].q)) return HITS[i].id;
  return null;
}
let dragging = null;
stage.addEventListener('pointerdown', ev => {
  ensureAudio();
  if (playing) pause();
  const p = toCanvas(ev);
  if (CROP.armed) {
    CROP.pending = null; hideChooser();
    CROP.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    stage.setPointerCapture(ev.pointerId);
    return;
  }
  const id = pick(p);
  SELECTED = id;
  drawOverlay();
  renderPanel();
  if (!id) return;
  const it = itm(id);
  dragging = { id, startX: p.x, startY: p.y, dx: it.dx, dy: it.dy, scale: p.scale };
  stage.setPointerCapture(ev.pointerId);
});
stage.addEventListener('pointermove', ev => {
  if (CROP.drag) {
    const p = toCanvas(ev);
    CROP.drag.x1 = p.x; CROP.drag.y1 = p.y;
    drawOverlay();
    return;
  }
  if (!dragging) { const p = toCanvas(ev); stage.style.cursor = CROP.armed ? 'crosshair' : (pick(p) ? 'grab' : 'default'); return; }
  const p = toCanvas(ev);
  const it = itm(dragging.id);
  it.dx = dragging.dx + (p.x - dragging.startX) / 1;
  it.dy = dragging.dy + (p.y - dragging.startY) / 1;
  renderFrame(time);
  drawOverlay();
  stage.style.cursor = 'grabbing';
});
stage.addEventListener('pointerup', () => {
  dragging = null;
  if (CROP.drag) {
    const r = cropRect();
    CROP.drag = null;
    if (r && r.w >= 16 && r.h >= 16) { CROP.pending = r; showChooser(r); }
    drawOverlay();
    return;
  }
  stage.style.cursor = CROP.armed ? 'crosshair' : 'grab';
});
stage.addEventListener('dblclick', ev => {
  const p = toCanvas(ev);
  const id = pick(p);
  if (id && isLetterId(id)) { SELECTED = parentOf(id); refresh(); renderPanel(); }
});
stage.addEventListener('pointercancel', () => { dragging = null; });

/* ---------------- panel ---------------- */
function renderPanel() {
  const box = document.getElementById('itemBox');
  const id = SELECTED;
  if (!id) {
    box.innerHTML = '<p class="muted">Nothing selected.<br>Click something on the video.</p>';
    return;
  }
  if (isLetterId(id)) { renderLetterPanel(id, box); return; }
  const it = itm(id);
  if (it.img) { renderCropPanel(id, box); return; }
  const se = specEl(id);
  if (se && se.type === 'code') { renderCodePanel(id, it, se, box); return; }
  const isText = it.text !== undefined || it.size !== undefined;
  box.innerHTML = `
    <div class="sel-head">
      <span class="dot"></span>
      <strong>${labelOf(id)}</strong>
    </div>
    ${isText ? `
      <label class="row"><span>Text</span>
        <input id="inText" type="text" value="${(it.text === undefined ? '' : String(it.text)).replace(/"/g, '&quot;')}">
      </label>
      <label class="row"><span>Size</span>
        <input id="inSize" type="range" min="16" max="260" step="1" value="${it.size || 60}">
      </label>
      <label class="row"><span>Colour</span>
        <input id="inColor" type="color" value="${toHex(it.color || '#16161F')}">
      </label>
      <label class="row"><span>Font</span>
        <select id="inFont">${fontNames().map(f => `<option value="${f}"${(it.family || 'sans-serif') === f ? ' selected' : ''}>${f}</option>`).join('')}</select>
      </label>
      <label class="row"><span>Weight</span>
        <input id="inWeight" type="range" min="300" max="900" step="100" value="${it.weight || 800}">
      </label>
      <label class="row"><span>Spacing</span>
        <input id="inLs" type="range" min="-8" max="24" step="0.5" value="${it.ls === undefined ? 0 : it.ls}">
      </label>
      <div class="row btns"><button id="bFontLoad" class="ghost">⤒ Load a font file (.ttf / .otf / .woff)</button>
        <button id="bFontReset" class="ghost">↺ Base font</button></div>` : ''}
    ${(it.erases && it.erases.length) ? `<div class="row btns"><button id="bErases" class="ghost">🧽 ${it.erases.length} erased patch${it.erases.length > 1 ? 'es' : ''} — clear</button></div>` : ''}
    <div class="row btns">
      <button id="bHide" class="ghost">${it.hidden ? '👁 Show' : '🚫 Hide'}</button>
      <button id="bReset" class="ghost">↺ Reset</button>
    </div>
    <div class="row btns">
      <button id="bLeft" class="ghost">◀</button>
      <button id="bUp" class="ghost">▲</button>
      <button id="bDown" class="ghost">▼</button>
      <button id="bRight" class="ghost">▶</button>
    </div>
    <p class="muted small">Drag on the video to move · Del hides it</p>`;
  const t = document.getElementById('inText');
  if (t) t.oninput = () => { itm(id).text = t.value; refresh(); renderItems(); };
  const s = document.getElementById('inSize');
  if (s) s.oninput = () => { itm(id).size = +s.value; refresh(); renderItems(); };
  const c = document.getElementById('inColor');
  if (c) c.oninput = () => { itm(id).color = c.value; refresh(); renderItems(); };
  const ff = document.getElementById('inFont');
  if (ff) ff.onchange = () => { setFontOf([id], { family: ff.value }); };
  const fw = document.getElementById('inWeight');
  if (fw) fw.oninput = () => { setFontOf([id], { weight: +fw.value }); };
  const fl = document.getElementById('inLs');
  if (fl) fl.oninput = () => { setFontOf([id], { ls: +fl.value }); };
  const bfl = document.getElementById('bFontLoad');
  if (bfl) bfl.onclick = () => document.getElementById('fontIn').click();
  const bfr = document.getElementById('bFontReset');
  if (bfr) bfr.onclick = () => { delete EDIT.items[id].family; delete EDIT.items[id].weight; delete EDIT.items[id].ls; refresh(); renderPanel(); };
  const be = document.getElementById('bErases');
  if (be) be.onclick = () => { delete EDIT.items[id].erases; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bHide').onclick = () => { itm(id).hidden = !itm(id).hidden; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bReset').onclick = () => { delete EDIT.items[id]; refresh(); renderPanel(); renderItems(); };
  const nudge = (dx, dy) => { const o = itm(id); o.dx += dx; o.dy += dy; refresh(); };
  document.getElementById('bLeft').onclick = () => nudge(-12, 0);
  document.getElementById('bRight').onclick = () => nudge(12, 0);
  document.getElementById('bUp').onclick = () => nudge(0, -12);
  document.getElementById('bDown').onclick = () => nudge(0, 12);
}
function specEl(id) {
  const scenes = (typeof SPEC !== 'undefined' && SPEC.scenes) || [];
  if (/\.bgcode$/.test(id)) {                       // scene-level art code
    const sid = id.replace(/\.bgcode$/, '');
    const sc = scenes.find(s => s.id === sid);
    if (sc && sc.js) return { type: 'code', js: sc.js, w: W, h: H, label: 'Scene art (code)' };
  }
  for (let i = 0; i < scenes.length; i++) {
    const els = scenes[i].elements || [];
    for (let j = 0; j < els.length; j++) if (els[j].id === id) return els[j];
  }
  return null;
}
/* agent-written drawing code stays editable by hand */
function renderCodePanel(id, it, se, box) {
  const js = it.js !== undefined ? it.js : (se.js || '');
  box.innerHTML = `
    <div class="sel-head"><span class="dot"></span><strong>${labelOf(id)}</strong></div>
    <p class="muted small" style="margin:-2px 0 6px">Agent-written drawing code — edit it and the frame updates live.</p>
    <textarea id="inCode" class="code-ta" spellcheck="false"></textarea>
    <div class="row btns">
      <label class="row" style="flex:1"><span>W</span><input id="inW" type="number" step="10" value="${(it.w || se.w || 400)}"></label>
      <label class="row" style="flex:1"><span>H</span><input id="inH" type="number" step="10" value="${(it.h || se.h || 400)}"></label>
    </div>
    <div class="row btns">
      <button id="bHide" class="ghost">${it.hidden ? '👁 Show' : '🚫 Hide'}</button>
      <button id="bReset" class="ghost">↺ Reset</button>
    </div>
    <div class="row btns">
      <button id="bLeft" class="ghost">◀</button>
      <button id="bUp" class="ghost">▲</button>
      <button id="bDown" class="ghost">▼</button>
      <button id="bRight" class="ghost">▶</button>
    </div>
    <p class="muted small">H = helper: H.ink(path, fill, lw) · H.circle · H.rr · H.star · H.text · H.reg(x,y,w,h) · t · dur</p>`;
  const ta = document.getElementById('inCode');
  ta.value = js;
  ta.oninput = () => { itm(id).js = ta.value; refresh(); renderItems(); };
  const w = document.getElementById('inW');
  w.oninput = () => { itm(id).w = +w.value; refresh(); };
  const hh = document.getElementById('inH');
  hh.oninput = () => { itm(id).h = +hh.value; refresh(); };
  document.getElementById('bHide').onclick = () => { itm(id).hidden = !itm(id).hidden; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bReset').onclick = () => { delete EDIT.items[id]; refresh(); renderPanel(); renderItems(); };
  const nudge = (dx, dy) => { const o = itm(id); o.dx += dx; o.dy += dy; refresh(); };
  document.getElementById('bLeft').onclick = () => nudge(-12, 0);
  document.getElementById('bRight').onclick = () => nudge(12, 0);
  document.getElementById('bUp').onclick = () => nudge(0, -12);
  document.getElementById('bDown').onclick = () => nudge(0, 12);
}

function renderLetterPanel(id, box) {
  const it = itm(id);
  const dm = DRAWN[id] || {};
  const pm = DRAWN[parentOf(id)] || {};
  const cur = (it.char !== undefined && it.char !== null) ? it.char : (dm.char || glyphChar(id));
  box.innerHTML = `
    <div class="sel-head"><span class="dot"></span><strong>Letter “${cur || ' '}”</strong></div>
    <p class="muted small" style="margin:-2px 0 8px">${labelOf(id)}</p>
    <label class="row"><span>Letter</span>
      <input id="inChar" type="text" maxlength="3" value="${String(cur).replace(/"/g, '&quot;')}">
    </label>
    <label class="row"><span>Size</span>
      <input id="inSize" type="range" min="16" max="320" step="1" value="${it.size || dm.size || pm.size || 60}">
    </label>
    <label class="row"><span>Colour</span>
      <input id="inColor" type="color" value="${toHex(it.color || dm.color || '#16161F')}">
    </label>
    ${(it.erases && it.erases.length) ? `<div class="row btns"><button id="bErases" class="ghost">🧽 ${it.erases.length} erased patch${it.erases.length > 1 ? 'es' : ''} — clear</button></div>` : ''}
    <div class="row btns">
      <button id="bHide" class="ghost">${it.hidden ? '👁 Show' : '🚫 Hide'}</button>
      <button id="bReset" class="ghost">↺ Reset</button>
    </div>
    <div class="row btns"><button id="bWhole" class="ghost">⬆ Select whole word</button></div>
    <div class="row btns">
      <button id="bLeft" class="ghost">◀</button>
      <button id="bUp" class="ghost">▲</button>
      <button id="bDown" class="ghost">▼</button>
      <button id="bRight" class="ghost">▶</button>
    </div>
    <p class="muted small">Drag the letter on the video to move only that letter.<br>Type in “Letter” to replace just that glyph.</p>`;
  const c = document.getElementById('inChar');
  c.oninput = () => { itm(id).char = c.value; refresh(); renderItems(); };
  const s = document.getElementById('inSize');
  s.oninput = () => { itm(id).size = +s.value; refresh(); renderItems(); };
  const col = document.getElementById('inColor');
  col.oninput = () => { itm(id).color = col.value; refresh(); renderItems(); };
  const be = document.getElementById('bErases');
  if (be) be.onclick = () => { delete EDIT.items[id].erases; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bHide').onclick = () => { itm(id).hidden = !itm(id).hidden; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bReset').onclick = () => { delete EDIT.items[id]; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bWhole').onclick = () => { SELECTED = parentOf(id); refresh(); renderPanel(); };
  const nudge = (dx, dy) => { const o = itm(id); o.dx += dx; o.dy += dy; refresh(); };
  document.getElementById('bLeft').onclick = () => nudge(-8, 0);
  document.getElementById('bRight').onclick = () => nudge(8, 0);
  document.getElementById('bUp').onclick = () => nudge(0, -8);
  document.getElementById('bDown').onclick = () => nudge(0, 8);
}

function renderCropPanel(id, box) {
  const it = EDIT.items[id];
  const whole = (it.t0 === 0 && Math.abs(it.t1 - DUR) < 1e-6);
  box.innerHTML = `
    <div class="sel-head"><span class="dot"></span><strong>${it.label}</strong></div>
    <p class="muted small" style="margin:-2px 0 8px">still frame from ${it.t0.toFixed(1)}s–${it.t1.toFixed(1)}s · ${Math.round(it.w)}×${Math.round(it.h)} px</p>
    <label class="row"><span>Scale</span>
      <input id="inScale" type="range" min="10" max="260" step="1" value="${Math.round((it.scale === undefined ? 1 : it.scale) * 100)}">
    </label>
    <div class="row btns">
      <button id="bPiece" class="ghost">${it.piece ? '👁 Piece shown' : '🚫 Piece removed'}</button>
      <button id="bPatch" class="ghost">${it.patch ? '🧽 Hole filled' : '⭕ Hole empty'}</button>
    </div>
    <div class="row btns">
      <button id="bTime" class="ghost">${whole ? '⏱ Whole clip' : '⏱ This scene only'}</button>
      <button id="bDel" class="ghost">🗑 Delete</button>
    </div>
    <div class="row btns">
      <button id="bLeft" class="ghost">◀</button>
      <button id="bUp" class="ghost">▲</button>
      <button id="bDown" class="ghost">▼</button>
      <button id="bRight" class="ghost">▶</button>
    </div>
    <p class="muted small">Drag it on the video to move it. The elements under the box were removed
    for the whole clip, so nothing is left behind when the scene animates. “Hole filled” only paints
    a background patch — leave it off unless the box was over unregistered art.</p>`;
  const s = document.getElementById('inScale');
  s.oninput = () => { itm(id).scale = +s.value / 100; refresh(); };
  document.getElementById('bPiece').onclick = () => { itm(id).piece = !itm(id).piece; refresh(); renderPanel(); renderItems(); };
  document.getElementById('bPatch').onclick = () => { itm(id).patch = !itm(id).patch; refresh(); renderPanel(); };
  document.getElementById('bTime').onclick = () => {
    const it2 = itm(id);
    const sc = SCENES.find(s2 => time >= s2.in && time < s2.out) || null;
    if (it2.t0 === 0 && Math.abs(it2.t1 - DUR) < 1e-6) { it2.t0 = sc ? sc.in : 0; it2.t1 = sc ? sc.out : DUR; }
    else { it2.t0 = 0; it2.t1 = DUR; }
    refresh(); renderPanel();
  };
  document.getElementById('bDel').onclick = () => {
    delete EDIT.items[id]; delete CROP_IMGS[id];
    SELECTED = null; refresh(); renderPanel(); renderItems();
  };
  const nudge = (dx, dy) => { const o = itm(id); o.dx += dx; o.dy += dy; refresh(); };
  document.getElementById('bLeft').onclick = () => nudge(-12, 0);
  document.getElementById('bRight').onclick = () => nudge(12, 0);
  document.getElementById('bUp').onclick = () => nudge(0, -12);
  document.getElementById('bDown').onclick = () => nudge(0, 12);
}

function toHex(c) {
  if (typeof c === 'string' && c[0] === '#') return c;
  const m = String(c).match(/\d+/g);
  if (!m) return '#16161f';
  return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
}
function refresh() { renderFrame(time); drawOverlay(); renderElements(); try { drawBeats(); } catch (e) {} }

/* scene list */
function renderScenes() {
  const list = document.getElementById('sceneList');
  list.innerHTML = '';
  SCENES.forEach(s => {
    const st = EDIT.scenes[s.id] || {};
    const row = document.createElement('div');
    row.className = 'scene' + (st.hidden ? ' off' : '');
    row.innerHTML = `<button class="tiny" title="show/hide">${st.hidden ? '🚫' : '👁'}</button>
      <span class="sname">${s.name}</span><span class="stime">${s.in.toFixed(1)}s</span>`;
    row.querySelector('button').onclick = e => {
      e.stopPropagation();
      EDIT.scenes[s.id] = Object.assign({}, st, { hidden: !st.hidden });
      renderScenes(); refresh();
    };
    row.onclick = () => { pause(); setTime(s.in + 0.9); };
    list.appendChild(row);
  });
}
/* elements currently on screen (so anything can be selected even if it is tiny) */
function renderElements() {
  const box = document.getElementById('elList');
  if (!box) return;
  const seen = [];
  HITS.forEach(h => { if (!isLetterId(h.id) && seen.indexOf(h.id) < 0) seen.push(h.id); });
  if (!seen.length) { box.innerHTML = '<p class="muted small">Nothing drawn at this time.</p>'; return; }
  box.innerHTML = '';
  seen.reverse().forEach(id => {                 // topmost first
    const b = document.createElement('button');
    b.className = 'chip' + (id === SELECTED ? ' on' : '');
    b.textContent = labelOf(id);
    b.onclick = () => { SELECTED = id; refresh(); renderPanel(); };
    box.appendChild(b);
  });
}

/* item list */
function isEdited(id) {
  const it = EDIT.items[id];
  if (!it) return false;
  if (it.img) return true;
  if (it.erases && it.erases.length) return true;
  if (it.dx || it.dy || it.hidden) return true;
  const b = EDIT.base[id] || {};
  if (it.char !== undefined && it.char !== null && it.char !== '') return true;
  if (it.text !== undefined && it.text !== b.text) return true;
  if (it.size !== undefined && it.size !== b.size) return true;
  if (it.color !== undefined && it.color !== b.color) return true;
  return false;
}
function renderItems() {
  const list = document.getElementById('itemList');
  const ids = Object.keys(EDIT.items).filter(isEdited);
  if (!ids.length) { list.innerHTML = '<p class="muted small">No edits yet — everything is still original.</p>'; return; }
  list.innerHTML = '';
  ids.forEach(id => {
    const it = EDIT.items[id];
    const row = document.createElement('div');
    row.className = 'scene' + (it.hidden ? ' off' : '');
    row.innerHTML = `<span class="sname">${labelOf(id)}${it.text !== undefined && it.text !== null ? ' — “' + String(it.text).slice(0, 22) + '”' : ''}</span>`;
    row.onclick = () => { SELECTED = id; refresh(); renderPanel(); };
    list.appendChild(row);
  });
}

/* ---------------- export ---------------- */
/* keep the finished file on screen: a link the human can click if the browser
   blocked the automatic download (private mode, "ask where to save", iOS…). */
function offerDownload(blob, name) {
  const box = document.getElementById('dlBox');
  const url = URL.createObjectURL(blob);
  window.__LAST_EXPORT = { url, name, size: blob.size };
  if (!box) return window.__LAST_EXPORT;
  box.innerHTML = '';
  const a = document.createElement('a');
  a.href = url; a.download = name; a.textContent = '⬇ ' + name + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB';
  a.title = 'click to save the video again';
  const b = document.createElement('a');
  b.href = url; b.target = '_blank'; b.rel = 'noopener'; b.className = 'alt'; b.textContent = 'open';
  b.title = 'open the video in a new tab';
  box.appendChild(a); box.appendChild(b);
  return window.__LAST_EXPORT;
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function exportVideo() {
  const status = document.getElementById('status');
  if (!SPEC.scenes || !SPEC.scenes.length) {
    status.textContent = 'Nothing to export yet — ask the agent to build a video first.';
    return;
  }
  if (window.__EXPORTING) { status.textContent = 'An export is already running — give it a moment.'; return; }

  /* only the render buttons lock up, and only until the export really ends */
  const LOCK = ['btnExport', 'btnPoster', 'btnPlay', 'btnStart', 'btnReset'];   // save/load stay usable
  const lockUI = v => LOCK.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = v; });
  window.__EXPORTING = true;
  window.EXPORT_CANCEL = false;
  lockUI(true);

  let rec = null, aDest = null, srcNode2 = null;
  let finished = false, watchdog = null;
  const chunks = [];
  const unlock = (msg) => {
    if (finished) return;
    finished = true;
    if (watchdog) clearTimeout(watchdog);
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    try { stopPlaybackMedia(); } catch (e) {}
    try { if (srcNode && aDest) srcNode.disconnect(aDest); } catch (e) {}
    try { if (srcNode2 && aDest) srcNode2.disconnect(aDest); } catch (e) {}
    try { if (MEDIA && MEDIA.node && aDest) MEDIA.node.disconnect(aDest); } catch (e) {}
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
    window.EXPORT_MODE = false;
    window.__EXPORTING = false;
    lockUI(false);
    if (msg) status.textContent = msg;
  };
  /* if the recorder or the tab stalls, the UI must never stay dead */
  watchdog = setTimeout(() => unlock('Export took too long and was unlocked. Keep this tab in front and try again.'), (DUR + 30) * 1000);

  try {
    ensureAudio();
    if (actx && actx.state === 'suspended') { try { await actx.resume(); } catch (e) {} }
    if (MUSIC && MUSIC.dataUrl) { try { hookMusicAudio(); } catch (e) {} }
    pause();
    status.textContent = 'Rendering video… keep this tab visible (records in real time, ' + DUR.toFixed(1) + 's).';
    window.EXPORT_MODE = true;
    setTime(0);
    await new Promise(r => setTimeout(r, 300));

    aDest = actx ? actx.createMediaStreamDestination() : null;
    let hasAudio = false;
    if (aDest && srcNode && MUSIC.on !== false) { try { srcNode.connect(aDest); hasAudio = true; } catch (e) {} }
    if (aDest && window.MEDIA && MEDIA.video && MEDIA.video.src && !MEDIA.node) {
      try { MEDIA.node = actx.createMediaElementSource(MEDIA.video); MEDIA.node.connect(actx.destination); } catch (e) {}
    }
    if (aDest && window.MEDIA && MEDIA.node) { try { MEDIA.node.connect(aDest); hasAudio = true; } catch (e) {} }

    try { await ensureSfxBuffers(); } catch (e) {}
    if (actx) { try { sfxBusNode().connect(aDest); } catch (e) {} }
    const vStream = stage.captureStream(30);
    const tracks = [...vStream.getVideoTracks()];
    const sfxOn = SFX.some(s => s.on !== false);
    if (aDest && (hasAudio || sfxOn)) { hasAudio = true; tracks.push(...aDest.stream.getAudioTracks()); }
    const stream = new MediaStream(tracks);
    /* mp4 first: a .webm often "doesn't export" on a phone because nothing opens it.
       Anything the browser refuses falls back to webm, which every Chrome can record. */
    /* mp4/H.264 plays on phones and in WhatsApp; if the project has sound an mp4
       must carry AAC, otherwise webm+opus is the honest choice. */
    const types = hasAudio
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2',
         'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
         'video/mp4;codecs=avc1.42E01E', 'video/mp4']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
         'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
         'video/mp4'];   // bare "video/mp4" can be VP9-in-MP4 → last resort only
    const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 });
    } catch (err) {
      unlock('This browser cannot record video here. Try Chrome or Edge.');
      return;
    }
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.start(200);

    startPlaybackMedia();
    if (audioEl && audioEl.src) { try { audioEl.currentTime = 0; audioEl.play().catch(() => {}); } catch (e) {} }

    const t0 = performance.now();
    /* setTimeout, not requestAnimationFrame: rAF stops when the tab is in the background,
       which used to freeze the export (and leave every button disabled) forever */
    await new Promise(resolve => {
      let done = false;
      const tick = () => {
        if (done) return;
        if (finished) { done = true; return resolve(); }
        if (window.EXPORT_CANCEL) { done = true; return resolve(); }
        try {
          const tPrev = time;
          const t = (performance.now() - t0) / 1000;
          time = Math.min(DUR, t);
          try { sfxTick(tPrev, time); } catch (e) {}
          renderFrame(time);
          drawOverlay();
          document.getElementById('scrub').value = String(time);
          document.getElementById('clock').textContent = time.toFixed(2) + 's / ' + DUR.toFixed(2) + 's';
          if (MUSIC && MUSIC.dataUrl) { try { audioEl.volume = musicVolAt(time); } catch (e) {} }
          status.textContent = 'Rendering video… ' + Math.round((time / DUR) * 100) + '%';
          if (t >= DUR) { done = true; return resolve(); }
        } catch (err) {
          console.error('export frame failed', err);
          done = true;
          return resolve();
        }
        setTimeout(tick, 33);
      };
      tick();
    });

    if (window.EXPORT_CANCEL) { window.EXPORT_CANCEL = false; unlock('Export cancelled — nothing was saved.'); return; }

    /* let the recorder swallow the last frames, then stop — but never wait forever */
    status.textContent = 'Finishing the file…';
    await new Promise(r => setTimeout(r, 320));
    await new Promise(res => {
      let settled = false;
      const fin = () => { if (!settled) { settled = true; res(); } };
      try { rec.onstop = fin; rec.onerror = fin; } catch (e) {}
      try { if (rec.requestData) rec.requestData(); } catch (e) {}
      setTimeout(fin, 8000);
      try { rec.stop(); } catch (e) { fin(); }
    });
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}

    let blob = new Blob(chunks, { type: mime || 'video/webm' });
    if (!blob.size) { unlock('Recording produced no data — try again with this tab in front.'); return; }
    let isMp4 = false;
    try {
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const ftyp = String.fromCharCode(head[4], head[5], head[6], head[7]);
      const ebml = head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
      isMp4 = ftyp === 'ftyp' && !ebml;
      if (isMp4) {           // mp4 only counts if it carries H.264, else players choke on it
        const head2 = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
        let txt = ''; for (let i = 0; i < head2.length; i++) txt += String.fromCharCode(head2[i]);
        if (!/avc1|avc3|hvc1/.test(txt)) isMp4 = false;
      }
    } catch (e) { isMp4 = (mime || '').includes('avc1'); }
    const ext = isMp4 ? 'mp4' : 'webm';
    blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
    const fname = 'ai-video.' + ext;
    const info = offerDownload(blob, fname);        // visible link — a blocked auto-download is no longer a dead end
    download(blob, fname);
    unlock('Saved ' + fname + ' (' + (blob.size / 1048576).toFixed(1) + ' MB) · ' + DUR.toFixed(1) + 's'
      + (ext === 'webm' ? ' · webm opens everywhere in a browser; use the link for a phone.' : '.')
      + (blob.size < 20000 ? ' · the file is very small — if it looks empty, record again with the tab in front.' : ''));
    setTime(0);
  } catch (err) {
    console.error('export failed', err);
    unlock('Export failed: ' + ((err && err.message) || err) + ' — nothing is locked, try again.');
  } finally {
    unlock();
  }
}

function exportPoster() {
  stage.toBlob(b => download(b, 'ai-video-poster.png'), 'image/png');
}

/* ---------------- project save / load ---------------- */
function saveProject() {
  SPEC.fonts = Object.keys(CUSTOM_FONTS).length ? CUSTOM_FONTS : undefined;
  const data = JSON.stringify({ spec: SPEC, items: EDIT.items, scenes: EDIT.scenes, base: EDIT.base }, null, 2);
  download(new Blob([data], { type: 'application/json' }), 'ai-video-project.json');
}
function loadProject(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (d.spec) {
        SPEC = d.spec; buildScenes(); syncSpec();
        if (SPEC.sfx) { SFX.length = 0; SPEC.sfx.forEach(s => SFX.push(Object.assign({}, s))); renderSfxList(); }
        if (SPEC.music) {
          Object.assign(MUSIC, SPEC.music);
          if (MUSIC.dataUrl) { audioEl.src = MUSIC.dataUrl; hookMusicAudio(); }
          applyMusic(true);
        }
        if (SPEC.fonts) Object.keys(SPEC.fonts).forEach(n => registerFont(n, SPEC.fonts[n]));
      }
      EDIT.items = d.items || {};
      EDIT.scenes = d.scenes || {};
      EDIT.base = d.base || EDIT.base;
      renderScenes(); refresh(); renderPanel(); renderItems();
      document.getElementById('status').textContent = 'Project loaded.';
    } catch (e) { document.getElementById('status').textContent = 'Could not read that file.'; }
  };
  fr.readAsText(file);
}
function resetAll() {
  if (!confirm('Reset every edit and restore the original video?')) return;
  EDIT.items = {}; EDIT.scenes = {}; EDIT.base = {};
  for (const k in CROP_IMGS) delete CROP_IMGS[k];
  SELECTED = null;
  renderScenes(); refresh(); renderPanel(); renderItems();
  document.getElementById('status').textContent = 'Everything restored to the generated video.';
}

/* ---------------- layout / wiring ---------------- */
function fitStage() {
  const wrap = document.getElementById('stageWrap');
  const availH = wrap.clientHeight - 24;
  const availW = wrap.clientWidth - 24;
  const ar = stage.width / stage.height;
  let h = availH, w = h * ar;
  if (w > availW) { w = availW; h = w / ar; }
  [stage, overlay].forEach(c => { c.style.width = w + 'px'; c.style.height = h + 'px'; });
}
window.addEventListener('resize', fitStage);

document.getElementById('btnPlay').onclick = () => (playing ? pause() : play());
document.getElementById('btnRestart').onclick = () => { pause(); setTime(0); };
function syncLetterBtn() {
  const b = document.getElementById('btnLetter');
  if (b) { b.textContent = '🔤 Letters: ' + (LETTER_MODE ? 'ON' : 'OFF'); b.classList.toggle('primary', LETTER_MODE); }
}
document.getElementById('btnLetter').onclick = () => {
  LETTER_MODE = !LETTER_MODE; syncLetterBtn(); refresh(); renderPanel();
};
document.getElementById('btnCrop').onclick = () => { pause(); armCrop(); };
document.getElementById('cpCut').onclick = () => makeCrop('cut');
document.getElementById('cpErase').onclick = () => makeCrop('erase');
document.getElementById('cpCancel').onclick = () => { CROP.pending = null; armCrop(false); };
document.getElementById('btnStart').onclick = () => { pause(); setTime(0); };
document.getElementById('btnExport').onclick = exportVideo;
document.getElementById('btnPoster').onclick = () => { pause(); exportPoster(); };
document.getElementById('btnSave').onclick = saveProject;
document.getElementById('btnLoad').onclick = () => document.getElementById('fileIn').click();
document.getElementById('fileIn').onchange = e => { if (e.target.files[0]) loadProject(e.target.files[0]); };
document.getElementById('btnReset').onclick = resetAll;
document.getElementById('scrub').oninput = e => { pause(); setTime(+e.target.value); };
/* emergency unlock: never leave the page with dead buttons */
window.unstickUI = function () {
  if (window.__EXPORTING) { window.EXPORT_CANCEL = true; return 'cancelling the export…'; }
  document.querySelectorAll('button[disabled]').forEach(b => { b.disabled = false; });
  let busy = false;
  try { busy = !!BUSY; } catch (err) { busy = false; }
  if (busy) { const s = document.getElementById('btnSend'), t = document.getElementById('btnStop'); if (s) s.disabled = true; if (t) t.disabled = false; }
  return 'unlocked';
};
const isTyping = el => {
  if (!el || !el.tagName) return false;
  const t = el.tagName;
  /* text fields, but also buttons/links: Space there means "press this button",
     so the page-level shortcut must stay out of the way */
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' ||
         t === 'A' || t === 'OPTION' || el.isContentEditable === true;
};
document.addEventListener('keydown', e => {
  /* the space bar belongs to whoever is typing — it must never start playback,
     delete the selected element or steal Delete/Backspace in the chat box */
  if (isTyping(e.target)) {
    if (e.key === 'Escape' && e.target.blur) e.target.blur();
    return;
  }
  if (e.key === 'Escape') { window.unstickUI(); }
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && SELECTED) { itm(SELECTED).hidden = true; refresh(); renderPanel(); }
  if (e.key === 'Escape') {
    if (CROP.armed || CROP.pending) { armCrop(false); return; }
    SELECTED = null; refresh(); renderPanel();
  }
  const step = e.shiftKey ? 40 : 12;
  if (SELECTED && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const it = itm(SELECTED);
    if (e.key === 'ArrowLeft') it.dx -= step;
    if (e.key === 'ArrowRight') it.dx += step;
    if (e.key === 'ArrowUp') it.dy -= step;
    if (e.key === 'ArrowDown') it.dy += step;
    refresh();
  }
});


