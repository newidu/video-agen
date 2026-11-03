/* Spec updates, media upload bridge and final boot wiring. Extracted from original/source.html lines 4374-4525. */
/* ---------- applying the answer ---------- */
function normalizeSpec(s) {
  const out = { title: s.title || 'AI video', format: s.format || SPEC.format || '9:16', fps: 30, scenes: [] };
  if (s.style && typeof s.style === 'object') out.style = s.style;
  (s.scenes || []).forEach((sc, i) => {
    const elements = Array.isArray(sc.elements) ? sc.elements.slice(0, 40) : [];
    out.scenes.push({
      id: sc.id || ('s' + (i + 1)),
      name: sc.name || sc.title || ('Scene ' + (i + 1)),
      dur: Math.max(0.6, Math.min(30, +sc.dur || 2.5)),
      bg: sc.bg || '#F1F7FF',
      media: sc.media || null,
      js: typeof sc.js === 'string' && sc.js.trim() ? sc.js : undefined,
      elements: elements.map((el, j) => Object.assign({ x: 540, y: 900 }, el, { id: el.id || (sc.id || ('s' + (i + 1))) + '.e' + j }))
    });
  });
  return out;
}
function applyAgentResult(obj) {
  if (!obj) return;
  if (obj.action === 'replace' && obj.spec) {
    SPEC = normalizeSpec(obj.spec);
    EDIT.items = {}; EDIT.scenes = {}; EDIT.base = {};
    SELECTED = null;
    buildScenes(); syncSpec();
    document.getElementById('status').textContent = 'New video from the agent · ' + SCENES.length + ' scenes · ' + DUR.toFixed(1) + 's';
    return;
  }
  if (obj.ops && obj.ops.length) {
    const n = applyOps(obj.ops);
    buildScenes(); syncSpec();
    document.getElementById('status').textContent = n + ' edit' + (n === 1 ? '' : 's') + ' from the agent.';
  }
}
function findScene(id) { return SPEC.scenes.find(s => s.id === id); }
function applyOps(ops) {
  let n = 0;
  ops.forEach(o => {
    try {
      const sc = SPEC.scenes.find(s => (o.id || '').indexOf(s.id + '.') === 0 || s.id === o.id);
      if (o.op === 'set') {
        if (o.id === 'format' || o.id === 'global') { if (o.format) SPEC.format = o.format; n++; return; }
        if (sc) {
          const el = (sc.elements || []).find(e => e.id === o.id);
          if (el) {
            ['text', 'x', 'y', 'size', 'color', 'align', 'ls', 'outline', 'weight', 'family', 'w', 'h',
              'anim', 'delay', 'type', 'label', 'js'].forEach(k => {
              if (o[k] !== undefined) el[k] = o[k];
            });
            if (o.items) el.items = o.items;
            const mirror = EDIT.items[o.id];               // keep the live edit record in sync
            if (mirror) ['text', 'size', 'color', 'label', 'x', 'y', 'w', 'h', 'js'].forEach(k => { if (o[k] !== undefined) mirror[k] = o[k]; });
            n++;
          }
        } else if (o.id && o.id.indexOf('.') < 0 && o.dur !== undefined) {
          const s2 = findScene(o.id); if (s2) { s2.dur = Math.max(0.6, +o.dur); n++; }
        }
        return;
      }
      if (o.op === 'hide' || o.op === 'show') { const it = itm(o.id); it.hidden = (o.op === 'hide'); n++; return; }
      if (o.op === 'retime' && o.id) { const s2 = findScene(o.id); if (s2) { s2.dur = Math.max(0.6, Math.min(30, +o.dur || s2.dur)); n++; } return; }
      if (o.op === 'scene_bg' && o.id) { const s2 = findScene(o.id); if (s2) { s2.bg = o.color || o.bg || s2.bg; n++; } return; }
      if (o.op === 'del_scene' && o.id) {
        const i = SPEC.scenes.findIndex(s => s.id === o.id);
        if (i >= 0) { SPEC.scenes.splice(i, 1); n++; }
        return;
      }
      if (o.op === 'add_scene' && o.scene) {
        const scaled = normalizeSpec({ scenes: [o.scene] }).scenes[0];
        if (o.at_end === false && o.index !== undefined) SPEC.scenes.splice(o.index, 0, scaled);
        else SPEC.scenes.push(scaled);
        n++;
        return;
      }
    } catch (e) { console.warn('op failed', o, e); }
  });
  return n;
}

/* ---------- spec ⇄ UI glue ---------- */
function syncSpec() {
  /* the music + beat clock live outside the spec, so re-attach them whenever
     the spec is replaced (agent replace_spec, format change, project load) */
  try {
    if (window.MUSIC && window.MUSIC.dataUrl) { if (!window.__APPLYING_MUSIC__) applyMusic(true); }
    else setBeat(MUSIC ? MUSIC.bpm : 120, MUSIC ? MUSIC.offset : 0);
  } catch (e) {}
  $('formatSel').value = SPEC.format || '9:16';
  $('scrub').max = String(DUR);
  fitStage();
  renderScenes();
  renderPanel();
  renderItems();
  renderElements();
  setTime(Math.min(time, Math.max(0, DUR - 0.05)));
}
$('formatSel').onchange = e => {
  SPEC.format = e.target.value;
  const fmt = FORMATS[SPEC.format];
  const oldW = stage.width, oldH = stage.height;
  const kx = fmt[0] / oldW, ky = fmt[1] / oldH;
  SPEC.scenes.forEach(sc => (sc.elements || []).forEach(el => { el.x = Math.round((el.x || 0) * kx); el.y = Math.round((el.y || 0) * ky); }));
  buildScenes(); syncSpec();
  document.getElementById('status').textContent = 'Format ' + SPEC.format + ' · ' + fmt[0] + '×' + fmt[1];
};

/* ---------- uploaded video ---------- */
function startPlaybackMedia() {
  if (MEDIA.video) { try { MEDIA.video.currentTime = 0; } catch (e) {} const p = MEDIA.video.play(); if (p && p.catch) p.catch(() => {}); }
}
function stopPlaybackMedia() { if (MEDIA.video) { try { MEDIA.video.pause(); } catch (e) {} } }
function ensureMediaAudio() {
  ensureAudio();
  if (!MEDIA.node && actx && MEDIA.video) {
    try { MEDIA.node = actx.createMediaElementSource(MEDIA.video); MEDIA.node.connect(actx.destination); } catch (e) { console.warn('media audio', e); }
  }
}
$('fileVideo').onchange = e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto'; v.muted = false;
  v.onloadeddata = () => {
    MEDIA.video = v; MEDIA.url = url; MEDIA.ready = true; MEDIA.node = null;
    const dur = Math.max(1, Math.min(30, v.duration || 6));
    const id = 'media' + (SPEC.scenes.length + 1);
    SPEC.scenes.push({
      id, name: 'My video', dur: +dur.toFixed(2), bg: '#000000',
      media: { fit: 'cover' },
      elements: []
    });
    buildScenes(); syncSpec();
    setTime((SCENES[SCENES.length - 1] || { in: 0 }).in + 0.1);
    ensureMediaAudio();
    sysNote('Added “' + f.name + '” as the last scene (' + dur.toFixed(1) + 's, ' + v.videoWidth + '×' + v.videoHeight + ', ~' + Math.round(dur * 30) + ' frames).\nAsk the agent: “how many frames does my clip have?” or “grab the frame at 1.5s”.');
    $('prompt').value = 'What is in my footage, how many frames does it have, and add a bold title over it?';
    document.getElementById('status').textContent = 'Video added · ' + dur.toFixed(1) + 's';
  };
  v.onerror = () => sysNote('That file could not be decoded by this browser. Try an mp4 (H.264) or webm.');
  e.target.value = '';
};

/* ---------- boot ---------- */
renderSkillList();
addUsage(null);
$('usage').textContent = '— tok';
sysNote('The stage is EMPTY — nothing is built in. The agent reads the skill pack and authors every scene itself (words, shapes, and its own drawing code for icons).\n1 · paste your DeepSeek key and press Save  2 · describe the video, or upload a clip and ask about it.\nTools: project info, frame counting, frame grabs, skill files, spec/ops, export — with its thinking and token use shown in the chat.');
buildScenes();
syncSpec();
document.getElementById('status').textContent = 'Blank stage — nothing is built in. Describe the video you want.';

