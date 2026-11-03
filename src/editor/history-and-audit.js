/* Undo/redo, snapshots, scene surgery and layout QA. Extracted from original/source.html lines 2528-2920. */
/* ============================================================
   TOOLBOX — undo/redo, snapshots, scene surgery, format and
   duration helpers, and a layout auditor. Everything here is
   available to the human (buttons / Ctrl+Z) and to the agent
   (tools that call window.TOOLBOX).
   ============================================================ */
const HISTORY = { stack: [], index: -1, last: '', suspend: 0 };
const SNAPSHOTS = {};
window.SNAPSHOTS = SNAPSHOTS;

function snapState() {
  return JSON.stringify({ spec: SPEC, items: EDIT.items, scenes: EDIT.scenes, base: EDIT.base });
}
function restoreState(json) {
  const d = JSON.parse(json);
  SPEC = d.spec;
  EDIT.items = d.items || {};
  EDIT.scenes = d.scenes || {};
  EDIT.base = d.base || {};
  SELECTED = null;
  buildScenes();
  syncSpec();
  refresh(); renderPanel(); renderItems(); renderScenes(); drawBeats();
}
function pushHistory(label) {
  if (Date.now() < HISTORY.suspend) return;
  const s = snapState();
  if (HISTORY.stack[HISTORY.index] && HISTORY.stack[HISTORY.index].s === s) return;
  HISTORY.stack = HISTORY.stack.slice(0, HISTORY.index + 1);
  HISTORY.stack.push({ s, label: label || 'edit' });
  if (HISTORY.stack.length > 40) HISTORY.stack.shift();
  HISTORY.index = HISTORY.stack.length - 1;
  HISTORY.last = s;
  syncHistoryUI();
}
function syncHistoryUI() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) { u.disabled = HISTORY.index <= 0; u.title = HISTORY.index > 0 ? 'undo ' + (HISTORY.stack[HISTORY.index] || {}).label : 'nothing to undo'; }
  if (r) { r.disabled = HISTORY.index >= HISTORY.stack.length - 1; }
}
function undo() {
  if (HISTORY.index <= 0) return 'nothing to undo';
  HISTORY.index--;
  HISTORY.suspend = Date.now() + 1500;
  restoreState(HISTORY.stack[HISTORY.index].s);
  HISTORY.last = HISTORY.stack[HISTORY.index].s;
  syncHistoryUI();
  return 'undo → ' + (HISTORY.stack[HISTORY.index].label || 'previous state') + ' (' + HISTORY.index + '/' + (HISTORY.stack.length - 1) + ')';
}
function redo() {
  if (HISTORY.index >= HISTORY.stack.length - 1) return 'nothing to redo';
  HISTORY.index++;
  HISTORY.suspend = Date.now() + 1500;
  restoreState(HISTORY.stack[HISTORY.index].s);
  HISTORY.last = HISTORY.stack[HISTORY.index].s;
  syncHistoryUI();
  return 'redo → ' + (HISTORY.stack[HISTORY.index].label || 'next state');
}
/* the editor mutates SPEC/EDIT from a dozen places, so instead of hooking each
   one we watch the state and checkpoint it when it settles (1.2 s) */
setInterval(() => {
  if (Date.now() < HISTORY.suspend) return;
  const s = snapState();
  if (s !== HISTORY.last) { HISTORY.last = s; pushHistory('edit'); }
}, 1200);
if (!HISTORY.stack.length) setTimeout(() => pushHistory('start'), 600);

/* ---------- named snapshots ---------- */
function saveSnapshot(name) {
  SNAPSHOTS[name || ('snap ' + (Object.keys(SNAPSHOTS).length + 1))] = snapState();
  return Object.keys(SNAPSHOTS);
}
function loadSnapshot(name) {
  if (!SNAPSHOTS[name]) return null;
  pushHistory('before restore ' + name);
  restoreState(SNAPSHOTS[name]);
  return name;
}
function dropSnapshot(name) { delete SNAPSHOTS[name]; return Object.keys(SNAPSHOTS); }

/* ---------- scene surgery ---------- */
function newId(base) {
  let i = 1, id = base + '_copy';
  const taken = SPEC.scenes.map(s => s.id);
  while (taken.indexOf(id) >= 0) id = base + '_copy' + (++i);
  return id;
}
function cloneElement(el, sceneId, index) {
  const copy = JSON.parse(JSON.stringify(el));
  copy.id = sceneId + '.e' + index;
  return copy;
}
function duplicateScene(id, at) {
  const i = SPEC.scenes.findIndex(s => s.id === id);
  if (i < 0) return null;
  pushHistory('duplicate scene');
  const src = SPEC.scenes[i];
  const nid = newId(src.id);
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = nid;
  copy.name = (src.name || 'Scene') + ' (copy)';
  (copy.elements || []).forEach((el, k) => { el.id = nid + '.e' + k; });
  const pos = at === undefined || at === null ? i + 1 : Math.max(0, Math.min(SPEC.scenes.length, +at));
  SPEC.scenes.splice(pos, 0, copy);
  buildScenes(); syncSpec(); refresh();
  return { id: nid, at: pos, scenes: SPEC.scenes.length };
}
function moveScene(id, to) {
  const i = SPEC.scenes.findIndex(s => s.id === id);
  if (i < 0) return null;
  pushHistory('move scene');
  const [sc] = SPEC.scenes.splice(i, 1);
  SPEC.scenes.splice(Math.max(0, Math.min(SPEC.scenes.length, +to)), 0, sc);
  buildScenes(); syncSpec(); refresh();
  return SPEC.scenes.map(s => s.id);
}
function splitScene(id, at) {
  const i = SPEC.scenes.findIndex(s => s.id === id);
  if (i < 0) return null;
  const sc = SPEC.scenes[i];
  const dur = +sc.dur || 2;
  const cut = Math.max(0.3, Math.min(dur - 0.3, +at));
  if (!(cut > 0.3)) return 'the split point must sit at least 0.3 s from either end';
  pushHistory('split scene');
  const second = JSON.parse(JSON.stringify(sc));
  second.id = newId(sc.id);
  second.dur = +(dur - cut).toFixed(2);
  (second.elements || []).forEach((el, k) => { el.id = second.id + '.e' + k; });
  sc.dur = +cut.toFixed(2);
  SPEC.scenes.splice(i + 1, 0, second);
  buildScenes(); syncSpec(); refresh();
  return { first: sc.id, firstDur: sc.dur, second: second.id, secondDur: second.dur };
}
function duplicateElement(id, toScene) {
  let scene = null, idx = -1;
  SPEC.scenes.forEach(sc => (sc.elements || []).forEach((el, i) => { if ((el.id || (sc.id + '.e' + i)) === id) { scene = sc; idx = i; } }));
  if (!scene) return null;
  pushHistory('duplicate element');
  const target = toScene && SPEC.scenes.find(s => s.id === toScene) ? SPEC.scenes.find(s => s.id === toScene) : scene;
  const el = target === scene ? scene.elements[idx] : scene.elements[idx];
  const copy = cloneElement(el, target.id, (target.elements || []).length);
  target.elements = target.elements || [];
  target.elements.push(copy);
  buildScenes(); syncSpec(); refresh();
  return copy.id;
}

/* ---------- format / duration ---------- */
function setFormat(fmt) {
  if (!FORMATS[fmt]) return null;
  pushHistory('format ' + fmt);
  const f = FORMATS[fmt];
  const oldW = stage.width || W, oldH = stage.height || H;
  SPEC.format = fmt;
  const kx = f[0] / W, ky = f[1] / H;
  if (kx !== 1 || ky !== 1) {
    SPEC.scenes.forEach(sc => (sc.elements || []).forEach(el => {
      el.x = Math.round((el.x || 0) * kx);
      el.y = Math.round((el.y || 0) * ky);
      if (el.size) el.size = Math.round(el.size * Math.min(kx, ky));
    }));
  }
  buildScenes(); syncSpec(); refresh();
  return { format: fmt, size: f[0] + 'x' + f[1] };
}
function fitDuration(seconds) {
  const target = Math.max(1, Math.min(600, +seconds));
  const total = SPEC.scenes.reduce((n, s) => n + (+s.dur || 0), 0) || 1;
  const k = target / total;
  pushHistory('duration ' + target + 's');
  SPEC.scenes.forEach(s => { s.dur = Math.max(0.4, +((+s.dur || 0) * k).toFixed(2)); });
  const now = SPEC.scenes.reduce((n, s) => n + s.dur, 0);
  if (Math.abs(now - target) > 0.05) SPEC.scenes[SPEC.scenes.length - 1].dur = +(SPEC.scenes[SPEC.scenes.length - 1].dur + (target - now)).toFixed(2);
  buildScenes(); syncSpec(); refresh();
  return { requested: target, actual: +DUR.toFixed(2), scenes: SPEC.scenes.length };
}

/* ---------- layout auditor ---------- */
function auditLayout(withRender) {
  const issues = [];
  if (withRender !== false) {
    try {
      const ink = inkAudit();
      (ink.cut_off || []).forEach(o => issues.push({ id: o.id, why: 'painted pixels ' + o.edges + ' at ' + o.t + 's — ' + o.why + ' (ink box ' + o.box.join(',') + ')' }));
      const r = renderedAudit();
      r.off_frame.forEach(o => issues.push({ id: o.id, why: (o.edges.indexOf('safe margin') >= 0 ? 'drifts ' : 'is cut off the frame — ') + o.edges + ' at ' + o.t + 's' }));
      r.overlaps.forEach(o => issues.push({ id: o.pair, why: 'boxes overlap by ' + o.pct + '% at ' + o.t + 's (as rendered)' }));
    } catch (e) { issues.push({ id: 'render-audit', why: 'could not sample frames: ' + (e.message || e) }); }
  }
  const pad = 40;
  const total = DUR;
  if (!SPEC.scenes.length) return { ok: false, issues: [{ id: 'project', why: 'no scenes at all' }] };
  SPEC.scenes.forEach((sc, si) => {
    const els = (sc.elements || []).map((el, i) => Object.assign({}, el, { id: el.id || (sc.id + '.e' + i) }));
    if (!els.length) issues.push({ id: sc.id, why: 'scene has no elements (blank frame)' });
    if (els.length > 12) issues.push({ id: sc.id, why: els.length + ' elements on one scene — crowded' });
    if ((+sc.dur || 0) < 0.8) issues.push({ id: sc.id, why: 'scene is ' + (+sc.dur || 0).toFixed(2) + 's — too fast to read' });
    const boxes = [];
    els.forEach(el => {
      if (el.type === 'text') {
        const it = EDIT.items[el.id] || {};
        const size = it.size || el.size || 96;
        const txt = String(it.text !== undefined ? it.text : (el.text || ''));
        const w = measure(txt, size, it.weight || el.weight || 800, it.family || el.family || 'sans-serif', it.ls || el.ls || 0);
        const h = size * 1.2;
        const x = (el.x || 0) + (it.dx || 0), y = (el.y || 0) + (it.dy || 0);
        boxes.push({ id: el.id, x: x - w / 2, y: y - h / 2, w, h, size, txt });
        if (size < 24) issues.push({ id: el.id, why: 'text is ' + Math.round(size) + 'px — unreadable on a phone' });
        if (x - w / 2 < pad || x + w / 2 > W - pad || y - h / 2 < pad || y + h / 2 > H - pad)
          issues.push({ id: el.id, why: 'touches the safe margin (40px) — “' + txt.slice(0, 18) + '” at ' + Math.round(x) + ',' + Math.round(y) });
      } else if (el.type === 'code') {
        const w = el.w || 300, h = el.h || 300;
        boxes.push({ id: el.id, x: (el.x || 0) - w / 2, y: (el.y || 0) - h / 2, w, h, size: 0, txt: el.label || 'code' });
      }
    });
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], Bx = boxes[b];
      const ox = Math.max(0, Math.min(A.x + A.w, Bx.x + Bx.w) - Math.max(A.x, Bx.x));
      const oy = Math.max(0, Math.min(A.y + A.h, Bx.y + Bx.h) - Math.max(A.y, Bx.y));
      const inter = ox * oy;
      if (inter > 0.3 * Math.min(A.w * A.h, Bx.w * Bx.h))
        issues.push({ id: A.id + ' / ' + Bx.id, why: 'boxes overlap by ' + Math.round(inter / Math.min(A.w * A.h, Bx.w * Bx.h) * 100) + '% — “' + String(A.txt).slice(0, 14) + '” vs “' + String(Bx.txt).slice(0, 14) + '”' });
    }
  });
  if (total > 90) issues.push({ id: 'project', why: 'the video is ' + total.toFixed(0) + 's — long for a short-form piece' });
  return { ok: !issues.length, duration: +total.toFixed(2), scenes: SPEC.scenes.length, issues: issues.slice(0, 40) };
}


/* ---------- rendered-geometry audit ----------
   static checks read the spec; this one reads what the engine ACTUALLY drew:
   every element registers its quad through regQuad() (after animation offsets,
   scale, element dx/dy), so off-frame art and colliding boxes are caught even
   when the declared x/y looked fine. Sampled across the timeline because
   `anim:"slide"` only leaves the frame mid-shot. */
function renderedAudit(samples) {
  const times = samples || [0.08, 0.25, 0.5, 0.75, 0.94].map(k => Math.max(0, Math.min(DUR - 0.001, DUR * k)));
  const t0 = time;
  const off = {}, over = {};
  times.forEach(t => {
    renderFrame(t);
    const boxes = HITS.filter(h => h.id.indexOf('#') < 0).map(h => {
      const xs = h.q.map(p => p[0]), ys = h.q.map(p => p[1]);
      return { id: h.id, x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
        w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
    });
    boxes.forEach(b => {
      const left = -b.x, right = b.x + b.w - W, top = -b.y, bottom = b.y + b.h - H;
      const worst = Math.max(left, right, top, bottom);
      if (worst > 2) {
        const edges = [];
        if (left > 2) edges.push('left by ' + Math.round(left) + 'px');
        if (right > 2) edges.push('right by ' + Math.round(right) + 'px');
        if (top > 2) edges.push('top by ' + Math.round(top) + 'px');
        if (bottom > 2) edges.push('bottom by ' + Math.round(bottom) + 'px');
        const prev = off[b.id];
        if (!prev || worst > prev.px) off[b.id] = { id: b.id, t: +t.toFixed(2), px: Math.round(worst), edges: edges.join(', ') };
      }
      const inner = 40;
      const margin = Math.max(-(b.x - inner), -(b.y - inner), (b.x + b.w) - (W - inner), (b.y + b.h) - (H - inner));
      if (worst <= 2 && margin > 1) {
        const prev = off[b.id + '~m'];
        if (!prev || margin > prev.px) off[b.id + '~m'] = { id: b.id, t: +t.toFixed(2), px: Math.round(margin), edges: 'inside the 40px safe margin' };
      }
    });
    for (let a = 0; a < boxes.length; a++) for (let b2 = a + 1; b2 < boxes.length; b2++) {
      const A = boxes[a], B = boxes[b2];
      const ox = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x));
      const oy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
      const inter = ox * oy, small = Math.min(A.w * A.h, B.w * B.h) || 1;
      const pct = Math.round(inter / small * 100);
      if (pct > 30) {
        const key = A.id + ' / ' + B.id;
        const prev = over[key];
        if (!prev || pct > prev.pct) over[key] = { pair: key, t: +t.toFixed(2), pct };
      }
    }
  });
  setTime(t0);
  const offList = Object.keys(off).map(k => off[k]).sort((x, y) => y.px - x.px);
  const overList = Object.values(over).map(o => ({ pair: o.pair, t: o.t, pct: o.pct }));
  return { off_frame: offList, overlaps: overList };
}


/* ---------- true ink boxes ----------
   A code element registers only its declared box, so art drawn outside it
   (a ribbon wider than its w/h) slipped past every numeric check. Here we
   render the frame, hide one element, render again and diff the two images:
   the pixels that changed ARE that element, so the box is what was really
   painted. Only used by audit() — it costs two renders per element. */
function framePixels() {
  const c = document.getElementById('stage');
  const g = c.getContext('2d');
  return g.getImageData(0, 0, c.width, c.height).data;
}
function inkBoxes(t) {
  const list = [];
  SPEC.scenes.forEach((sc, si) => {
    const inScene = t >= SCENES[si].in && t < SCENES[si].out;
    if (!inScene) return;
    (sc.elements || []).forEach((el, i) => {
      const id = el.id || (sc.id + '.e' + i);
      const it = EDIT.items[id] || {};
      if (it.hidden) return;
      list.push({ id, scene: si });
    });
  });
  if (!list.length || list.length > 28) return [];
  renderFrame(t);
  const base = framePixels();
  const out = [];
  list.forEach(({ id }) => {
    const it = itm(id);
    const was = it.hidden;
    it.hidden = true;
    renderFrame(t);
    const without = framePixels();
    it.hidden = was;
    const w = stage.width, h = stage.height;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const p = row + x * 4;
        if (base[p] !== without[p] || base[p + 1] !== without[p + 1] || base[p + 2] !== without[p + 2] || base[p + 3] !== without[p + 3]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= 0) out.push({ id, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  });
  renderFrame(t);
  return out;
}
function inkAudit() {
  const t = Math.max(0, Math.min(DUR - 0.001, DUR * 0.5));
  const t0 = time;
  const bad = [];
  try {
    inkBoxes(t).forEach(b => {
      /* a canvas clips at its own edge, so "painted right up to the border" is
         the only honest signal that something ran off the frame */
      const touch = [];
      if (b.x <= 1) touch.push('left');
      if (b.x + b.w >= W - 1) touch.push('right');
      if (b.y <= 1) touch.push('top');
      if (b.y + b.h >= H - 1) touch.push('bottom');
      if (touch.length) {
        bad.push({ id: b.id, t: +t.toFixed(2), edges: 'touch the ' + touch.join(' + ') + ' edge',
          box: [b.x, b.y, b.w, b.h],
          why: touch.length > 1 ? 'that is full-bleed art — fine only if nothing readable is clipped'
             : 'art runs into the frame edge — check nothing is cut off' });
      }
    });
  } catch (e) { return { error: String(e && e.message || e) }; }
  setTime(t0);
  return { at: +t.toFixed(2), cut_off: bad };
}

window.TOOLBOX = {
  undo, redo, pushHistory,
  snap: saveSnapshot, restore: loadSnapshot, snaps: () => Object.keys(SNAPSHOTS), dropSnap: dropSnapshot,
  dupScene: duplicateScene, moveScene, splitScene, dupElement: duplicateElement,
  setFormat, fitDuration, audit: auditLayout, renderedAudit, inkAudit, inkBoxes,
  history: () => HISTORY.stack.map((h, i) => ({ i, label: h.label }))
};
(function wireToolbox() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) u.onclick = () => { const m = undo(); document.getElementById('status').textContent = m; };
  if (r) r.onclick = () => { const m = redo(); document.getElementById('status').textContent = m; };
  syncHistoryUI();
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
  });
})();

/* boot */
window.addEventListener('load', async () => {
  fitStage();
  try { await document.fonts.ready; } catch (e) {}
  buildScenes();
  syncSpec();
  setTime(0);
  drawBeats(); renderMusicBox();
  setTimeout(() => { fitStage(); drawBeats(); }, 120);
});

