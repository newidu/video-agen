/* Canvas primitives and text rendering. Extracted from original/source.html lines 334-521. */
/* ============================================================
   CANVAS PRIMITIVES — nothing else. No template, no art, no
   characters: paths, ink outlines, type, colour and easings that
   both the agent's drawing code and the editor build on.
   ============================================================ */
let W = 1080, H = 1920;   // set by the spec (9:16 / 16:9 / 1:1)
function setSize(w, h) { W = w; H = h; }
const INK = '#16161F';
const P = {
  cream: '#FFF3E3', cream2: '#FCE6C8',
  coral: '#FF6B4A', yellow: '#FFC83D', teal: '#22C3A6',
  blue: '#4C8DFF', purple: '#A96BFF', pink: '#FF8FB3', mint: '#7FE9CE'
};
const PAL = [P.coral, P.yellow, P.teal, P.blue, P.purple, P.pink];

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d');
let T = 0;

/* ---------------- math ---------------- */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const cl01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (t, a, b) => cl01((t - a) / (b - a));
const eOut = t => 1 - Math.pow(1 - t, 3);
const eIn = t => t * t * t;
const eInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const eOutBack = (t, s = 1.9) => { const c3 = s + 1; return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const eOutElastic = t => {
  if (t <= 0) return 0; if (t >= 1) return 1;
  return Math.pow(2, -9 * t) * Math.sin((t * 9 - 0.75) * (2 * Math.PI / 3)) + 1;
};
// damped spring progress 0 -> 1 with overshoot
const sp = (t, f = 3.4, d = 7) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(2 * Math.PI * f * t));
const spS = (t, f = 3.4, d = 7) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.sin(2 * Math.PI * f * t));
/* beat clock — 120 BPM until the music says otherwise (see setBeat) */
let B = 0.5;          // seconds per beat
let BEAT0 = 0;        // where beat 1 sits on the timeline
function setBeat(bpm, offset) {
  const v = +bpm;
  if (v >= 30 && v <= 300) B = 60 / v;
  BEAT0 = +offset || 0;
  return B;
}
const beatIndex = t => Math.floor((t - BEAT0) / B);
const beatPhase = t => { const p = ((t - BEAT0) % B + B) % B; return p / B; };   // 0..1 after each beat
const beatEnv = (t, decay = 4) => Math.pow(1 - beatPhase(t), decay);            // 1 on the beat -> 0
const beatPulse = (t, decay = 6) => (t < BEAT0 ? 0 : Math.pow(1 - beatPhase(t), decay));

function relLum(rgb) {
  const c = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function hexOrRgb(c, fallback) {
  const s = String(c || fallback || '#000');
  if (s[0] === '#') return hexRgb(s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s);
  const m = s.match(/\d+/g);
  return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}
function contrastRatio(a, b) {
  const l1 = relLum(hexOrRgb(a, '#000')), l2 = relLum(hexOrRgb(b, '#fff'));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mix(c1, c2, t) {
  const a = hexRgb(c1), b = hexRgb(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

/* ---------------- primitives ---------------- */
function rrPath(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// fill with a cartoon ink outline of thickness lw outside the path
function inkPath(build, fill, lw = 12) {
  ctx.beginPath(); build();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = lw * 2; ctx.stroke();
  if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fill(); }
}
function circlePath(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); ctx.closePath(); }
function starPath(x, y, R, r, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 ? r : R;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function polyPath(pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}
function star4Path(x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
    const rad = i % 2 ? r : R;
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
const GENERIC_FAMILIES = { 'sans-serif': 1, serif: 1, monospace: 1, cursive: 1, fantasy: 1, 'system-ui': 1 };
function fontStack(family) {
  const f = family || 'sans-serif';
  // "Noto Sinhala" sits in every stack: Latin keeps the chosen face, Sinhala
  // (and its marks) always resolve to the bundled shaper.
  /* order matters: the bundled Sinhala face only owns U+0D80-0DFF, then the
     family the human/agent chose, and only then a generic fallback — DejaVu used
     to sit in front of the chosen family and quietly swallowed every Latin glyph */
  const fam = GENERIC_FAMILIES[f] ? f : `"${f}"`;
  return `"Noto Sinhala", ${fam}, "DejaVu Sans", sans-serif`;
}
/* scripts where one "letter" is a base + marks (or a conjunct): drawing the
   string one code point at a time makes the shaper emit dotted circles, so
   these are always laid out by grapheme cluster — or in one pass. */
const COMPLEX_SCRIPT = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0900-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1780-\u17FF\u1800-\u18AF\u1A00-\u1AAF\u1B00-\u1B7F\u2D00-\u2D2F\uA980-\uA9DF\uAC00-\uD7FF]/;
const isComplexText = t => COMPLEX_SCRIPT.test(String(t || ''));
const MARK_RE = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u0610-\u061A\u064B-\u065F\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0D80-\u0D83\u0DCA\u0DD0-\u0DDF\u0DF2-\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u200C\u200D\uFE00-\uFE0F]/;
let SEGMENTER = null;
try { if (typeof Intl !== 'undefined' && Intl.Segmenter) SEGMENTER = new Intl.Segmenter('si', { granularity: 'grapheme' }); } catch (e) { SEGMENTER = null; }
/* split into editable units: code points for Latin, grapheme clusters for Indic */
function textUnits(txt) {
  const s = String(txt == null ? '' : txt);
  if (!isComplexText(s)) return [...s];
  if (SEGMENTER) { try { return [...SEGMENTER.segment(s)].map(x => x.segment); } catch (e) {} }
  const out = [];
  for (const ch of s) {
    if (out.length && MARK_RE.test(ch)) out[out.length - 1] += ch;
    else if (out.length && /\u0DCA$/.test(out[out.length - 1])) out[out.length - 1] += ch; // virama + next consonant
    else if (out.length && /\u200D$/.test(out[out.length - 1])) out[out.length - 1] += ch;  // ZWJ + consonant
    else out.push(ch);
  }
  return out;
}
function setFont(size, weight = 800, family = 'sans-serif', ls = 0) {
  ctx.font = `${weight} ${size}px ${fontStack(family)}`;
  ctx.letterSpacing = `${ls}px`;
}
function inkText(str, x, y, o = {}) {
  const size = o.size || 120, weight = o.weight || 800, family = o.family || 'sans-serif';
  setFont(size, weight, family, o.ls || 0);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.baseline || 'middle';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const ow = Math.min(o.outline === undefined ? 10 : o.outline, Math.max(0, size * 0.1));
  if (ow > 0) { ctx.strokeStyle = o.strokeColor || INK; ctx.lineWidth = ow * 2; ctx.strokeText(str, x, y); }
  ctx.fillStyle = o.color || INK;
  ctx.fillText(str, x, y);
  const w = ctx.measureText(str).width;
  ctx.letterSpacing = '0px';
  return w;
}
function measure(str, size, weight = 800, family = 'sans-serif', ls = 0) {
  setFont(size, weight, family, ls);
  const w = ctx.measureText(str).width;
  ctx.letterSpacing = '0px';
  return w;
}

/* ---------------- background ---------------- */
function layoutWord(word, size, ls, weight = 800, family = 'sans-serif') {
  setFont(size, weight, family, ls);
  const widths = textUnits(word).map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) - ls;
  ctx.letterSpacing = '0px';
  const xs = []; let acc = -total / 2;
  widths.forEach((w, i) => { xs.push(acc + (w - ls) / 2); acc += w; });
  return { xs, total };
}

/* ============================================================
   SPEC ENGINE — turns a JSON video spec into a deterministic,
   time-driven canvas animation. Every element registers a hit
   box so the editor can select / move / retype / erase it.
   ============================================================ */
