/* Edit model, scene parsing, element rendering and frame rendering. Extracted from original/source.html lines 522-970. */
/* ---------------- edit model ---------------- */
const EDIT = { items: {}, scenes: {}, base: {} };
let HITS = [], SELECTED = null;
let LETTER_MODE = true;
const DRAWN = {};
const LABELMAP = {};          // id -> human label, filled from the spec
window.LABELMAP = LABELMAP;
let WASH = 0.1;

function itm(id, def) {
  if (!EDIT.items[id]) {
    EDIT.items[id] = Object.assign({ dx: 0, dy: 0, hidden: false }, def || {});
    EDIT.base[id] = { text: (def && def.text), size: (def && def.size), color: (def && def.color) };
  }
  return EDIT.items[id];
}
function regQuad(id, lx, ly, w, h) {
  const m = ctx.getTransform();
  const pts = [[lx, ly], [lx + w, ly], [lx + w, ly + h], [lx, ly + h]]
    .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  HITS.push({ id, q: pts });
}
const PART_PARENT = {};
function partOffset(id) {
  const it = EDIT.items[id] || { dx: 0, dy: 0 };
  const par = PART_PARENT[id];
  const p = par ? (EDIT.items[par] || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
  return { x: (it.dx || 0) + (p.dx || 0), y: (it.dy || 0) + (p.dy || 0) };
}
function applyEraseMask(it) {
  if (!it || !it.erases || !it.erases.length) return false;
  ctx.beginPath();
  ctx.rect(-1e6, -1e6, 2e6, 2e6);
  it.erases.forEach(r => ctx.rect(r.x, r.y, r.w, r.h));
  ctx.clip('evenodd');
  return true;
}
function eGroup(id, bx, by, bw, bh, fn, noReg) {
  const it = itm(id);
  if (it.hidden) return;
  const off = partOffset(id);
  ctx.save();
  ctx.translate(off.x, off.y);
  if (!noReg) regQuad(id, bx - bw / 2, by - bh / 2, bw, bh);
  applyEraseMask(it);
  fn();
  ctx.restore();
}
/* text drawn glyph by glyph so single letters can be moved / replaced.
   Complex scripts (Sinhala, Tamil, Devanagari, Arabic, Thai…) are laid out by
   grapheme cluster, and drawn in ONE pass when nobody has touched a letter —
   per-codepoint fillText breaks shaping and makes the shaper print U+25CC
   dotted circles instead of the vowel signs. */
function textIsEdited(id, n) {
  for (let i = 0; i < n; i++) {
    const li = EDIT.items[id + '#' + i];
    if (li && (li.hidden || li.dx || li.dy || li.size || li.color || (li.char !== undefined && li.char !== null))) return true;
  }
  return false;
}
/* An ink outline is drawn at 2× its value, so a fat outline on small type eats
   the letters and every word turns into a blob (see the 9.90s bug report).
   The outline can never be more than 10 % of the font size, and none at all
   under 22 px. */
function safeOutline(size, ow, strokeColor, fillColor) {
  const o = Math.max(0, +ow || 0);
  if (!o || size < 22) return 0;
  /* stroke and fill in the same colour is just "fake bold": the 2× stroke eats
     the counters and a 40px label turns into a black blob — drop it and let the
     weight do the job */
  if (!strokeColor || !fillColor || contrastRatio(strokeColor, fillColor) < 1.4) return 0;
  return Math.min(o, Math.max(1, size * 0.05));
}
function drawText(id, txt, x, y, o) {
  const size = o.size, color = o.color, ls = o.ls || 0;
  o = Object.assign({}, o, { outline: safeOutline(size, o.outline, o.strokeColor || INK, color) });
  const align = o.align || 'center';
  const weight = o.weight || 800, family = o.family || 'sans-serif';
  setFont(size, weight, family, 0);
  const chars = textUnits(txt);

  /* complex script, untouched: one fillText keeps the shaper happy */
  if (isComplexText(txt) && !textIsEdited(id, chars.length)) {
    const wFull = ctx.measureText(txt).width + ls * Math.max(0, chars.length - 1);
    const sx = align === 'center' ? x - wFull / 2 : align === 'right' ? x - wFull : x;
    DRAWN[id] = { size, color, txt, isWord: true };
    regQuad(id, sx, y - size * 0.62, wFull, size * 1.24);
    try { ctx.letterSpacing = ls + 'px'; } catch (e) {}
    ctx.textAlign = 'left'; ctx.textBaseline = o.baseline || 'middle';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (o.outline) { ctx.strokeStyle = o.strokeColor || INK; ctx.lineWidth = o.outline * 2; ctx.strokeText(txt, sx, y); }
    ctx.fillStyle = color; ctx.fillText(txt, sx, y);
    if (LETTER_MODE) regQuad(id + '#0', sx, y - size * 0.62, wFull, size * 1.24);
    ctx.letterSpacing = '0px';
    return wFull;
  }

  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + ls * Math.max(0, chars.length - 1);
  const startX = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

  DRAWN[id] = { size, color, txt, isWord: true };
  regQuad(id, startX, y - size * 0.62, total, size * 1.24);

  let cursor = startX;
  chars.forEach((ch, i) => {
    const key = id + '#' + i;
    const li = EDIT.items[key];
    if (li && li.hidden) { cursor += widths[i] + ls; return; }
    const glyph = (li && li.char !== undefined && li.char !== null) ? String(li.char) : ch;
    if (glyph.length) {
      const gs = (li && li.size) || size;
      const gc = (li && li.color) || color;
      const cx = cursor + widths[i] / 2 + (li ? li.dx : 0);
      const cy = y + (li ? li.dy : 0);
      setFont(gs, weight, family, 0);
      ctx.textAlign = 'center'; ctx.textBaseline = o.baseline || 'middle';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const gw = safeOutline(gs, o.outline, o.strokeColor || INK, gc || color);
      if (gw) { ctx.strokeStyle = o.strokeColor || INK; ctx.lineWidth = gw * 2; ctx.strokeText(glyph, cx, cy); }
      ctx.fillStyle = gc; ctx.fillText(glyph, cx, cy);
      DRAWN[key] = { size: gs, color: gc, char: glyph, parent: id };
      if (LETTER_MODE) {
        const bw = Math.max(widths[i], gs * 0.3);
        regQuad(key, cursor + bw * 0.03, cy - gs * 0.62, bw * 0.94, gs * 1.26);
      }
    }
    cursor += widths[i] + ls;
  });
  ctx.letterSpacing = '0px';
  return total;
}
/* keep a line inside the frame: shrink it instead of letting it run off the canvas */
function fitSize(txt, size, maxW, weight, family, ls) {
  const flat = String(txt).replace(/\n/g, ' ');
  if (!flat.length) return size;
  let s = size, guard = 0;
  while (guard++ < 10) {
    const w = measure(flat, s, weight, family, ls) + ls * Math.max(0, flat.length - 1);
    if (w <= maxW) break;
    s *= Math.max(0.55, maxW / w);
    if (s < 14) { s = 14; break; }
  }
  return Math.round(s);
}
function eText(id, def, x, y, o) {
  const it = itm(id, { text: def, size: o.size, color: o.color, label: def });
  if (it.hidden) return 0;
  /* the font tool writes family / weight / spacing onto the element */
  if (it.family) o = Object.assign({}, o, { family: it.family });
  if (it.weight !== undefined) o = Object.assign({}, o, { weight: +it.weight });
  if (it.ls !== undefined) o = Object.assign({}, o, { ls: +it.ls });
  let size = it.size || o.size;
  if (o.fit !== false) {
    const maxW = (W - 2 * (o.margin === undefined ? 90 : o.margin));
    size = fitSize(it.text === undefined || it.text === null ? def : it.text, size, maxW,
      o.weight || 800, o.family || 'sans-serif', o.ls || 0);
  }
  const color = it.color || o.color;
  const txt = it.text === undefined || it.text === null ? def : it.text;
  if (String(txt).length === 0) return 0;
  return drawText(id, String(txt), x + it.dx, y + it.dy, Object.assign({}, o, { size, color }));
}
function cropImg(id, url) {
  let im = CROP_IMGS[id];
  if (!im || im.__url !== url) { im = new Image(); im.__url = url; im.src = url; CROP_IMGS[id] = im; }
  return im;
}
const MEDIA = { video: null, url: '', ready: false, el: null, scene: null, node: null };
window.MEDIA = MEDIA;
function drawMediaLayer(sc, lt, t) {
  const mv = (sc.spec ? sc.spec.media : sc.media);
  if (!mv || !MEDIA.video || !MEDIA.ready) return;
  const v = MEDIA.video;
  const live = (typeof playing !== 'undefined' && playing) || window.EXPORT_MODE;
  if (MEDIA.scene !== sc.id) {
    MEDIA.scene = sc.id;
    try { v.currentTime = Math.max(0, lt); } catch (e) {}
    if (live) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
  } else if (!live && Math.abs((v.currentTime || 0) - lt) > 0.2) {
    try { v.currentTime = Math.max(0, lt); } catch (e) {}
  }
  const vw = v.videoWidth || W, vh = v.videoHeight || H;
  let dw = W, dh = H, dx = 0, dy = 0;
  if (mv.fit === 'contain') {
    const k = Math.min(W / vw, H / vh); dw = vw * k; dh = vh * k;
    dx = (W - dw) / 2; dy = (H - dh) / 2;
  } else {
    const k = Math.max(W / vw, H / vh); dw = vw * k; dh = vh * k;
    dx = (W - dw) / 2; dy = (H - dh) / 2;
  }
  ctx.save();
  if (mv.dim) { ctx.globalAlpha = 1; }
  ctx.drawImage(v, dx, dy, dw, dh);
  ctx.restore();
  regQuad('media' + (sc.id || ''), 0, 0, W, H);
}

function drawCrops(time) {
  for (const id of Object.keys(EDIT.items)) {
    const it = EDIT.items[id];
    if (!it || !it.img || it.hidden) continue;
    const t0 = it.t0 === undefined ? 0 : it.t0;
    const t1 = it.t1 === undefined ? 99 : it.t1;
    if (time < t0 || time >= t1) continue;
    const sc = it.scale === undefined ? 1 : it.scale;
    if (it.patch) {
      const px = it.piece ? it.x : it.x + it.dx;
      const py = it.piece ? it.y : it.y + it.dy;
      ctx.save();
      ctx.beginPath(); ctx.rect(px, py, it.w, it.h); ctx.clip();
      ctx.fillStyle = P.bg; ctx.fillRect(px, py, it.w, it.h);
      ctx.restore();
      if (!it.piece) regQuad(id, px, py, it.w, it.h);
    }
    if (it.piece) {
      const im = cropImg(id, it.img);
      const w = it.w * sc, h = it.h * sc;
      const x = it.x + it.dx + (it.w - w) / 2;
      const y = it.y + it.dy + (it.h - h) / 2;
      if (im.naturalWidth) ctx.drawImage(im, x, y, w, h);
      regQuad(id, x, y, w, h);
    }
  }
}

/* ---------------- spec → scenes ---------------- */
/* No template is shipped. The project starts EMPTY; the agent authors every scene. */
const DEFAULT_SPEC = { title: 'Untitled', format: '9:16', fps: 30, scenes: [] };

let SPEC = JSON.parse(JSON.stringify(DEFAULT_SPEC));
let SCENES = [];
/* DUR is declared in the editor part (shared top-level binding) */

const FORMATS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };

function animK(a, lt) {
  const d = a.delay || 0;
  const dur = a.dur === undefined ? 0.55 : a.dur;
  const raw = inv(lt - d, 0, Math.max(0.05, dur));
  switch (a.type) {
    case 'rise': return eOut(raw);
    case 'fade': return raw;
    case 'slideL': case 'slideR': return eOutBack(clamp(raw));
    case 'pop': return eOutBack(clamp(raw));
    case 'type': return raw;
    case 'beat': return 1;                      // visible the whole time, pulsed below
    case 'none': return raw > 0 ? 1 : 0;
    default: return eOutBack(clamp(raw));
  }
}
function animOffset(a, k, lt) {
  const d = a.delay || 0;
  const dist = a.dist === undefined ? 90 : a.dist;
  switch (a.type) {
    case 'rise': return { dy: (1 - k) * dist, sc: 1 };
    case 'slideL': return { dy: 0, sc: 1, dx: -(1 - k) * dist * 2.2 };
    case 'slideR': return { dy: 0, sc: 1, dx: (1 - k) * dist * 2.2 };
    case 'pop': return { dy: 0, sc: lerp(0.72, 1, k) };
    case 'fade': return { dy: 0, sc: 1 };
    default: return { dy: 0, sc: 1 };
  }
}

/* ---------------- agent-authored drawing code ----------------
   A "code" element is a piece of JS the agent writes to draw its own
   art (icons, logos, illustrations). It runs on the canvas, is fully
   deterministic, and the whole element stays selectable / movable /
   hidable / resetable exactly like the built-in types.               */
const CODE_CACHE = {};
const ART = {
  P: P, PAL: PAL, INK: INK, clamp: clamp, lerp: lerp, mix: mix,
  eOut: eOut, eIn: eIn, eInOut: eInOut, eOutExpo: eOutExpo, eOutBack: eOutBack,
  sp: sp, spS: spS, beatEnv: beatEnv, inv: inv,
  circle: circlePath, rr: rrPath, star: starPath, star4: star4Path, poly: polyPath,
  ink: inkPath, setFont: setFont, text: inkText, measure: measure,
  fill(fn, color) { fn(); ctx.fillStyle = color; ctx.fill(); },
  stroke(fn, color, lw) { fn(); ctx.strokeStyle = color || INK; ctx.lineWidth = lw || 10; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); },
  reg(lx, ly, w, h) { if (ART.id) regQuad(ART.id, lx, ly, w, h); },
  rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); },
  W: W, H: H, t: 0, dur: 1, id: null, e: null
};
window.ART = ART;

const CODE_ERRORS = {};        // id -> last error message, read by the agent
window.CODE_ERRORS = CODE_ERRORS;

function runCode(js, el, id, lt, sdur) {
  if (!js) { delete CODE_ERRORS[id]; return; }
  let fn = CODE_CACHE[js];
  if (!fn) {
    try { fn = new Function('ctx', 'e', 'H', 't', 'dur', 'w', 'h', js); }
    catch (err) { CODE_ERRORS[id] = 'compile: ' + err.message; CONSOLE_ONCE(js, err); CODE_CACHE[js] = function () {}; return; }
    CODE_CACHE[js] = fn;
  }
  ART.W = W; ART.H = H; ART.t = lt; ART.dur = sdur; ART.id = id; ART.e = el;
  try {
    fn(ctx, el, ART, lt, sdur, el.w || 400, el.h || 400);
    delete CODE_ERRORS[id];
  } catch (err) {
    CODE_ERRORS[id] = 'runtime: ' + err.message;
    CONSOLE_ONCE(js + err.message, err);
  }
}
const CONSOLE_ONCE = (() => {
  const seen = {};
  return (key, err) => { if (seen[key]) return; seen[key] = 1; console.warn('element code', err && err.message); };
})();

function drawEl(sc, el, i, lt) {
  const id = (el.id || (sc.id + '.e' + i));
  const liveEdit = (typeof EDIT !== 'undefined' && EDIT.items) ? EDIT.items[id] : null;
  const shownText = liveEdit && liveEdit.text !== undefined && liveEdit.text !== null ? liveEdit.text : el.text;
  const isCode = el.type === 'code' || el.js !== undefined;
  LABELMAP[id] = el.label || (isCode
    ? 'Code art ' + (i + 1)
    : 'Text “' + String(shownText || '').slice(0, 22) + '”');
  const a = { type: el.anim || 'pop', delay: el.delay || 0, dur: el.dur, dist: el.dist };
  const k0 = animK(a, lt);
  const it = EDIT.items[id];
  const globalHidden = it && it.hidden;

  ctx.save();
  if (a.type === 'fade') ctx.globalAlpha = clamp(k0);

  const drawBody = () => {
    if (isCode) {
      const cw = (it && it.w) || el.w || 400, chh = (it && it.h) || el.h || 400;
      eGroup(id, el.x, el.y, cw, chh, () => {
        const jsrc = (it && it.js !== undefined) ? it.js : el.js;
        ctx.save();
        ctx.translate(el.x, el.y);
        runCode(jsrc, el, id, lt, (sc.out - sc.in));
        ctx.restore();
      });
      return;
    }
    if (el.type === 'text') {
      eText(id, String(el.text === undefined ? '' : el.text), el.x, el.y, {
        size: el.size || 96, color: el.color || INK, align: el.align || 'center',
        ls: el.ls || 0, outline: el.outline || 0, weight: el.weight || 800, strokeColor: el.strokeColor,
        family: el.family || 'sans-serif',
        fit: el.fit === undefined ? true : !!el.fit,
        margin: el.margin === undefined ? 90 : +el.margin
      });
    }
  };

  const off = animOffset(a, k0, lt);
  /* anim:"beat" keeps the element on screen and punches it with the music */
  if (a.type === 'beat') { off.sc = 1 + (el.dist === undefined ? 0.09 : +el.dist) * beatPulse(lt); off.dy = 0; off.dx = 0; }
  if (off.sc !== 1 || off.dy || off.dx) {
    const anchor = elAnchor(el);
    ctx.translate(anchor.x, anchor.y);
    ctx.scale(off.sc, off.sc);
    ctx.translate(-anchor.x, -anchor.y + off.dy);
    if (off.dx) ctx.translate(off.dx, 0);
  }
  if (!globalHidden) drawBody();
  ctx.restore();
}
function elAnchor(el) {
  return { x: el.x || W / 2, y: el.y || H / 2 };
}

function buildScenes() {
  const fmt = FORMATS[SPEC.format] || FORMATS['9:16'];
  setSize(fmt[0], fmt[1]);
  const cv = document.getElementById('stage');
  cv.width = fmt[0]; cv.height = fmt[1];
  const ov = document.getElementById('overlay');
  ov.width = fmt[0]; ov.height = fmt[1];
  document.getElementById('stageInner').style.aspectRatio = fmt[0] + ' / ' + fmt[1];

  /* make sure every element carries a stable id so ops / labels / edits can address it */
  (SPEC.scenes || []).forEach((sc, i) => {
    if (!sc.id) sc.id = 's' + (i + 1);
    (sc.elements || []).forEach((el, j) => { if (!el.id) el.id = sc.id + '.e' + j; });
  });

  SCENES = [];
  let t = 0;
  (SPEC.scenes || []).forEach((sc, i) => {
    const dur = Math.max(0.4, sc.dur === undefined ? 3 : +sc.dur);
    SCENES.push({
      id: sc.id || ('s' + (i + 1)),
      in: t, out: t + dur, name: (i + 1) + ' · ' + (sc.name || sc.title || 'Scene ' + (i + 1)),
      spec: sc
    });
    t += dur;
  });
  DUR = Math.max(1, t);
  /* drop labels that belonged to scenes we no longer have */
  const liveIds = {};
  SCENES.forEach(s => { liveIds[s.id] = 1; });
  Object.keys(LABELMAP).forEach(k => { if (!liveIds[String(k).split('.')[0]]) delete LABELMAP[k]; });
  window.DUR = DUR;
  window.SCENES = SCENES;
  window.SPEC = SPEC;
}

/* nothing built yet — a blank canvas, nothing drawn on it */
function drawEmptyStage() { P.bg = '#FFFFFF'; }
window.drawEmptyStage = drawEmptyStage;

function renderFrame(time) {
  T = time;
  HITS = [];
  for (const k in DRAWN) delete DRAWN[k];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const sc = SCENES.find(s => time >= s.in && time < s.out) || SCENES[SCENES.length - 1];
  if (MEDIA.video && (!sc || !sc.spec.media)) {
    MEDIA.scene = null;
    if (!MEDIA.video.paused) { try { MEDIA.video.pause(); } catch (e) {} }
  }
  const st = sc ? EDIT.scenes[sc.id] : null;
  const bg = (sc && sc.spec.bg) || '#FFFFFF';
  P.bg = bg;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!sc) { drawEmptyStage(); return; }
  if (st && st.hidden) { drawCrops(time); return; }
  const lt = time - sc.in;
  WASH = 0.09;
  if (sc.spec.media) drawMediaLayer(sc, lt, time);
  /* scene-level art code — the agent can paint a whole backdrop, still selectable as one element */
  if (sc.spec.js) {
    const bgid = sc.id + '.bgcode';
    LABELMAP[bgid] = 'Scene art (code)';
    const bit = itm(bgid);
    if (!bit.hidden) {
      eGroup(bgid, W / 2, H / 2, W, H, () => {
        const bjs = bit.js !== undefined ? bit.js : sc.spec.js;
        ctx.save();
        runCode(bjs, { x: 0, y: 0, w: W, h: H, type: 'code', scene: sc.id }, bgid, lt, sc.out - sc.in);
        ctx.restore();
      });
    }
  }
  (sc.spec.elements || []).forEach((el, i) => {
    try { drawEl(sc, el, i, lt); } catch (err) { console.warn('element', el && el.type, err); }
  });
  drawCrops(time);
}
window.renderFrame = renderFrame;
window.buildScenes = buildScenes;
window.ready = document.fonts.ready.then(() => true);

