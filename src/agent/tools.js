/* Agent tool implementations, tool catalog and JSON tool schema. Extracted from original/source.html lines 3369-3951. */
/* ---------- tools ---------- */
function codeErrNote() {
  const errs = Object.keys(window.CODE_ERRORS || {});
  if (!errs.length) return ' No code errors on this frame.';
  return ' CODE ERRORS — fix these: ' + errs.map(id => id + ': ' + window.CODE_ERRORS[id]).join('; ');
}
function compactProject() {
  const out = {
    format: SPEC.format, fps: 30, duration: +DUR.toFixed(2), frames: Math.round(DUR * 30),
    scenes: SCENES.map(s => ({
      id: s.id, name: s.name, in: +s.in.toFixed(2), out: +s.out.toFixed(2), dur: +(s.out - s.in).toFixed(2),
      bg: s.spec.bg, media: !!s.spec.media,
      elements: (s.spec.elements || []).map((el, i) => ({
        id: el.id || (s.id + '.e' + i), type: el.type, text: el.text,
        x: el.x, y: el.y, size: el.size, color: el.color,
        edited: !!EDIT.items[el.id || (s.id + '.e' + i)],
        js: el.type === 'code' ? ((el.js || '').length + ' chars of code') : undefined
      }))
    }))
  };
  if (SPEC.style) out.style = SPEC.style;
  if (window.MUSIC_API) {
    const m = window.MUSIC_API.status();
    out.music = { track: m.track, on: window.MUSIC_API.isOn(), bpm: m.bpm, offset: m.offset, length: m.length, beats: m.beats };
    const fx = window.SFX_API ? window.SFX_API.list() : [];
    out.sfx = { count: fx.length, on: fx.filter(s => s.on).length, sounds: fx.slice(0, 12) };
  }
  const errs = Object.keys(window.CODE_ERRORS || {});
  if (errs.length) out.code_errors = errs.map(id => id + ': ' + window.CODE_ERRORS[id]);
  return out;
}
function frameStats() {
  try {
    const c = document.createElement('canvas');
    c.width = 48; c.height = Math.round(48 * H / W);
    const g = c.getContext('2d');
    g.drawImage(stage, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const rr = d[i] >> 4 << 4, gg = d[i + 1] >> 4 << 4, bb = d[i + 2] >> 4 << 4;
      r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
      const k = rr + ',' + gg + ',' + bb;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 6)
      .map(([k, v]) => '#' + k.split(',').map(x => (+x).toString(16).padStart(2, '0')).join('') + '(' + Math.round(v / n * 100) + '%)');
    return { mean: 'rgb(' + Math.round(r / n) + ',' + Math.round(gr / n) + ',' + Math.round(b / n) + ')', palette: top };
  } catch (e) { return { error: String(e) }; }
}
function fileSizeLabel(bytes) { return (bytes / 1048576).toFixed(2) + ' MB'; }

async function countVideoFrames() {
  const v = MEDIA.video;
  if (!v) return null;
  // decode the clip at high speed and count real frames
  const clone = document.createElement('video');
  clone.src = v.src; clone.muted = true; clone.playsInline = true; clone.preload = 'auto';
  await new Promise((res, rej) => {
    clone.onloadeddata = res;
    clone.onerror = () => rej(new Error('could not decode'));
    setTimeout(res, 4000);
  });
  let frames = 0;
  const d = clone.duration || 0;
  await new Promise(resolve => {
    let live = true;
    const tick = (now, meta) => {
      frames++;
      if (!live) return;
      if (clone.ended || clone.currentTime >= d - 0.02 || frames > 20000) { live = false; return resolve(); }
      clone.requestVideoFrameCallback(tick);
    };
    clone.requestVideoFrameCallback(tick);
    const play = clone.play();
    if (play && play.catch) play.catch(() => { live = false; resolve(); });
    setTimeout(() => { if (live) { live = false; resolve(); } }, Math.min(15000, d * 1000 + 2000));
  });
  try { clone.pause(); } catch (e) {}
  return { frames, duration: +d.toFixed(3), fps: d ? +(frames / d).toFixed(2) : 0,
           width: clone.videoWidth, height: clone.videoHeight };
}

let READ_BEAT = 0, WRITE_BEAT = 0;         // Claude-Code style: you must read before you rewrite
function noteRead() { READ_BEAT = ++WRITE_BEAT; }
function noteWrite() { WRITE_BEAT++; }
function needRead(what) {
  return READ_BEAT < WRITE_BEAT
    ? what + ' refused: the project changed since you last looked. Call get_project() (or verify_video()) first, then edit.'
    : null;
}

/* Tools that only make sense while music is switched on. The human can flip
   music OFF from the toolbar; when it is OFF these tools disappear from the
   schema the model receives, from the prompt it reads, and the calls are
   refused — so the agent cannot create music behind a switch that is off. */
/* Deferred tool loading (what Claude Code 2.1.x does with MCP tools): only the
   core set travels with every request; the rest is discovered through
   find_tools() and added to the session once it is actually needed. */
const CORE_TOOLS = ['get_project', 'replace_spec', 'apply_ops', 'add_element', 'set_text',
  'remove_element', 'verify_video', 'export_video', 'todo_write', 'find_elements',
  'read_skill', 'list_skill_files', 'find_tools',
  'undo', 'audit', 'snapshot', 'restore_snapshot'];   // recovery + QA must never be a discovery away
let ACTIVE_TOOLS = {};
try { ACTIVE_TOOLS = JSON.parse(localStorage.getItem('aiva_active_tools') || '{}') || {}; } catch (e) { ACTIVE_TOOLS = {}; }
function isActiveTool(name) { return CORE_TOOLS.indexOf(name) >= 0 || !!ACTIVE_TOOLS[name]; }
function activateTool(name) {
  if (!TOOL_IMPL[name]) return false;
  ACTIVE_TOOLS[name] = 1;
  try { localStorage.setItem('aiva_active_tools', JSON.stringify(ACTIVE_TOOLS)); } catch (e) {}
  return true;
}
function resetActiveTools() {
  ACTIVE_TOOLS = {};
  try { localStorage.removeItem('aiva_active_tools'); } catch (e) {}
}
function toolCatalog() {
  return Object.keys(TOOL_IMPL)
    .filter(n => !isActiveTool(n) && !toolHidden(n) && n !== 'find_tools')
    .map(n => ({ name: n, about: (TOOL_HELP[n] || '').split(/(?<=\.)\s/)[0].slice(0, 96) }));
}
const MUSIC_ONLY_TOOLS = ['set_music', 'beat_map'];
function hiddenTools() {
  try {
    if (window.MUSIC_API && !window.MUSIC_API.isOn()) return MUSIC_ONLY_TOOLS;
  } catch (e) {}
  return [];
}
const toolHidden = name => hiddenTools().indexOf(name) >= 0;

const TOOL_IMPL = {
  todo_write(args) {
    const items = Array.isArray(args && args.items) ? args.items.slice(0, 24) : [];
    if (!items.length) { TODOS = []; renderTodos(TODOS); return 'plan cleared'; }
    TODOS = items.map(t => ({
      text: String(t.text || t.content || t.task || '').slice(0, 160),
      status: (['pending', 'in_progress', 'completed'].indexOf(t.status) >= 0) ? t.status : 'pending'
    })).filter(t => t.text);
    renderTodos(TODOS);
    const act = TODOS.filter(t => t.status === 'in_progress').length;
    return 'plan saved: ' + TODOS.length + ' tasks, ' + TODOS.filter(t => t.status === 'completed').length + ' done'
      + (act > 1 ? ' — WARNING: ' + act + ' tasks in progress, keep exactly one' : '')
      + '. Mark each one completed as soon as it is done.';
  },
  find_elements(args) {
    const q = String((args && args.q) || '').trim().toLowerCase();
    if (!q) return 'need {q}';
    const hits = [];
    SPEC.scenes.forEach(sc => (sc.elements || []).forEach((el, i) => {
      const hay = [el.id, el.type, el.text, el.label, el.family, (el.js || '').slice(0, 300)].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) hits.push({ id: el.id || (sc.id + '.e' + i), scene: sc.id, type: el.type || (el.js ? 'code' : '?'), text: el.text, y: el.y });
    }));
    return hits.length ? JSON.stringify(hits.slice(0, 25)) + (hits.length > 25 ? ' …' + hits.length + ' matches' : '') : 'nothing matches “' + q + '”';
  },
  async critique(args) {
    const focus = (args && args.focus) || 'composition, hierarchy, legibility, pacing, consistency with the brief';
    const t0 = time;
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const t = DUR * (i + 0.5) / 3;
      renderFrame(t);
      const st = frameStats();
      samples.push({ t: +t.toFixed(2), palette: (st.palette || []).slice(0, 4), hitboxes: HITS.length });
    }
    setTime(t0); drawOverlay();
    const sys = 'You are a ruthless motion-design critic reviewing another agent\'s video project. You cannot see the pixels, so judge from structure and stats. Answer with at most 8 short bullets, most damaging first, each naming the element id and the concrete fix. No praise, no restating the brief.';
    const usr = 'FOCUS: ' + focus +
      '\nPROJECT: ' + JSON.stringify(compactProject()).slice(0, 5000) +
      '\nFRAME SAMPLES: ' + JSON.stringify(samples) +
      '\nCODE ERRORS: ' + JSON.stringify(window.CODE_ERRORS || {});
    const acc = await streamChat([{ role: 'system', content: sys }, { role: 'user', content: usr }], null, () => {}, ABORT.signal);
    addUsage(acc.usage);
    return (acc.content || '(no critique came back)').slice(0, 1600);
  },
  verify_video() {
    noteRead();
    const t0 = time;
    const report = [];
    const errs = {};
    for (let i = 0; i < 6; i++) {
      const t = DUR * (i + 0.5) / 6;
      renderFrame(t);
      Object.keys(window.CODE_ERRORS).forEach(k => { errs[k] = window.CODE_ERRORS[k]; });
      const st = frameStats();
      const vis = HITS.length;
      report.push({ t: +t.toFixed(2), mean: st.mean, hitboxes: vis, palette: (st.palette || []).slice(0, 3) });
    }
    setTime(t0);
    /* readability sweep: any text whose colour sits too close to the scene
       background (or whose outline was fat enough to blob the letters) */
    const low = [];
    SPEC.scenes.forEach(sc => {
      const bg = sc.bg || (sc.media ? '#777' : '#000');
      (sc.elements || []).forEach((el, i) => {
        if (el.type !== 'text' || !el.text) return;
        const id = el.id || (sc.id + '.e' + i);
        const it = EDIT.items[id] || {};
        if (it.hidden) return;
        const col = it.color || el.color || '#16161F';
        const ratio = contrastRatio(col, bg);
        const ow = el.outline || 0, sz = it.size || el.size || 96;
        if (ratio < 2.2 || (ow > 0 && ow > sz * 0.1)) {
          low.push({ id, text: String(it.text || el.text).slice(0, 24), color: col, bg, contrast: +ratio.toFixed(2),
            outline: ow, size: sz, why: ratio < 2.2 ? 'too little contrast with the background' : 'outline thicker than 10% of the font size' });
        }
      });
    });
    let rendered = null;
    try { rendered = window.TOOLBOX.renderedAudit(); } catch (e) { rendered = null; }
    const out = {
      format: SPEC.format, duration: +DUR.toFixed(2), frames: Math.round(DUR * 30),
      off_frame: rendered && rendered.off_frame.length ? rendered.off_frame.slice(0, 12) : undefined,
      overlaps: rendered && rendered.overlaps.length ? rendered.overlaps.slice(0, 12) : undefined,
      scenes: SCENES.map(s => ({ id: s.id, name: s.name, dur: +(s.out - s.in).toFixed(2), elements: (s.spec.elements || []).length })),
      low_contrast: low.length ? low : undefined,
      samples: report,
      blank_frames: report.filter(r => r.hitboxes === 0).map(r => r.t)
    };
    const errList = Object.keys(errs).map(k => k + ': ' + errs[k]);
    if (errList.length) out.code_errors = errList;
    return JSON.stringify(out);
  },
  add_element(args) {
    const sceneId = args && args.sceneId;
    const el = args && args.element;
    if (!sceneId || !el || typeof el !== 'object') return 'need {sceneId, element}';
    const sc = SPEC.scenes.find(s => s.id === sceneId) || SPEC.scenes[0];
    if (!sc) return 'there is no scene yet — call replace_spec first';
    sc.elements = sc.elements || [];
    el.id = sc.id + '.e' + sc.elements.length;
    sc.elements.push(el);
    noteWrite();
    buildScenes(); syncSpec(); renderFrame(time);
    return 'added ' + el.id + ' (' + (el.type || (el.js ? 'code' : '?')) + ') to ' + sc.id + ' — the scene now has ' + sc.elements.length + ' elements';
  },
  set_text(args) {
    const blocked = needRead('set_text');
    if (blocked) return blocked;
    if (!args || !args.id) return 'need {id, text}';
    const id = args.id;
    const sc = SPEC.scenes.find(s => id.indexOf(s.id + '.') === 0);
    if (!sc) return 'no such element: ' + id;
    const el = (sc.elements || []).find(e => e.id === id);
    if (!el) return 'no such element: ' + id;
    el.text = String(args.text === undefined ? '' : args.text);
    const mirror = EDIT.items[id];
    if (mirror) mirror.text = el.text;
    noteWrite();
    buildScenes(); syncSpec(); renderFrame(time);
    return id + ' now reads “' + el.text + '”';
  },
  set_style(args) {
    const st = args && args.style;
    if (!st || typeof st !== 'object') return 'need {style: {...}}';
    SPEC.style = Object.assign({}, SPEC.style || {}, st);
    renderFrame(time);
    return 'style saved: ' + JSON.stringify(SPEC.style).slice(0, 400);
  },
  remove_element(args) {
    const blocked = needRead('remove_element');
    if (blocked) return blocked;
    const id = args && args.id;
    if (!id) return 'need {id}';
    for (const sc of SPEC.scenes) {
      const i = (sc.elements || []).findIndex(e => e.id === id);
      if (i >= 0) { sc.elements.splice(i, 1); noteWrite(); buildScenes(); syncSpec(); renderFrame(time); return 'removed ' + id; }
    }
    delete EDIT.items[id];
    noteWrite();
    renderFrame(time);
    return 'hid ' + id;
  },
  check_code(args) {
    const js = (args && args.js) || '';
    if (!js.trim()) return 'missing js';
    try { new Function('ctx', 'e', 'H', 't', 'dur', 'w', 'h', js); }
    catch (e) { return 'compile error: ' + e.message; }
    const t = +(args.t || 0.6);
    const probe = { x: W / 2, y: H / 2, w: 400, h: 400, type: 'code' };
    delete window.CODE_ERRORS.check_code;
    let threw = '';
    ctx.save();
    try { ctx.translate(probe.x, probe.y); runCode(js, probe, 'check_code', t, Math.max(0.5, DUR)); }
    catch (e) { threw = e.message; }
    ctx.restore();
    const caught = window.CODE_ERRORS.check_code || threw;
    delete window.CODE_ERRORS.check_code;
    renderFrame(time); drawOverlay();
    return caught ? caught : 'ok — compiles and runs clean at t=' + t + 's';
  },
  get_project() {
    noteRead();
    const mus = (window.MUSIC_API && window.MUSIC_API.status()) || null;
    return JSON.stringify(compactProject());
  },
  media_info() {
    if (!MEDIA.video) return 'No uploaded clip — the whole video is generated by the engine. Project frames: ' + Math.round(DUR * 30) + '.';
    const v = MEDIA.video;
    return JSON.stringify({
      file: (MEDIA.url || '').slice(0, 40) + '…', width: v.videoWidth, height: v.videoHeight,
      duration: +(v.duration || 0).toFixed(3), estimated_fps: 30,
      estimated_frames: Math.round((v.duration || 0) * 30),
      note: 'call count_frames() for the decoded frame count'
    });
  },
  async count_frames() {
    if (!MEDIA.video) return 'No uploaded clip to decode. Project frame count = ' + Math.round(DUR * 30) + ' (30 fps).';
    const r = await countVideoFrames();
    return r ? JSON.stringify(r) : 'could not decode';
  },
  grab_frame(args) {
    const t = Math.max(0, Math.min(DUR - 0.001, +(args && args.time !== undefined ? args.time : time)));
    setTime(t); renderFrame(t); drawOverlay();
    const stats = frameStats();
    const name = 'frame-' + t.toFixed(2) + 's.png';
    stage.toBlob(b => download(b, name), 'image/png');
    const thumb = stage.toDataURL('image/png');
    return { text: JSON.stringify({ saved: name, time: +t.toFixed(2), size: W + 'x' + H, bytes: '~' + Math.round(thumb.length * 0.75 / 1024) + ' KB', mean: stats.mean, palette: stats.palette }), thumb: thumb };
  },
  list_skill_files() { return SKILL_ORDER.join('\n'); },
  read_skill(args) {
    const p = args && args.path;
    if (!p || !SKILL_FILES[p]) return 'unknown file. Available:\n' + SKILL_ORDER.join('\n');
    const txt = SKILL_FILES[p];
    /* read-once policy: a second read of the same file is 3-6k tokens of text
       the model already has — send only the head and say so */
    FILE_READS[p] = (FILE_READS[p] || 0) + 1;
    if (FILE_READS[p] > 1) {
      return '[repeat read — ' + p + ' is already in this conversation. Head only:]\n' +
        txt.slice(0, 1200) + '\n…[re-read the earlier message for the rest]';
    }
    return txt.length > 12000 ? txt.slice(0, 12000) + '\n…(truncated at 12k chars — cite what you need)' : txt;
  },
  replace_spec(args) {
    if (!args || !args.spec) return 'missing spec';
    applyAgentResult({ action: 'replace', spec: args.spec, say: '' });
    noteWrite();
    renderFrame(time);
    return 'built ' + SCENES.length + ' scenes, ' + DUR.toFixed(2) + 's, ' + Math.round(DUR * 30) + ' frames at 30fps.'
      + codeErrNote();
  },
  apply_ops(args) {
    const blocked = needRead('apply_ops');
    if (blocked) return blocked;
    if (!args || !args.ops) return 'missing ops';
    const n = applyOps(args.ops);
    noteWrite();
    buildScenes(); syncSpec();
    renderFrame(time);
    return n + ' edits applied. Project is now ' + DUR.toFixed(2) + 's / ' + Math.round(DUR * 30) + ' frames.'
      + codeErrNote();
  },
  set_playhead(args) {
    const t = Math.max(0, Math.min(DUR - 0.001, +(args && args.time) || 0));
    pause(); setTime(t);
    const sc = SCENES.find(s => t >= s.in && t < s.out);
    return 'playhead at ' + t.toFixed(2) + 's' + (sc ? ' (scene ' + sc.name + ')' : '');
  },
  async export_video() {
    agentStatus('Exporting the video…');
    await exportVideo();
    return 'video exported (check the downloads).';
  },
  export_poster() { exportPoster(); return 'poster PNG exported.'; },
  /* ---------- music & beat ---------- */
  async set_music(args) {
    if (toolHidden('set_music')) return 'set_music is switched off: the human turned music OFF. Do not create music — carry on with visuals, sfx and text; music comes back when the human turns it on.';
    args = args || {};
    const api = window.MUSIC_API;
    if (args.clear) { api.set({ clear: true }); return 'music cleared.'; }
    if (args.generate) {
      const st = await api.make({ bpm: args.bpm, style: args.style || 'pop', duration: args.duration });
      if (args.volume !== undefined) api.set({ volume: args.volume });
      return 'generated a beat track: ' + JSON.stringify(api.status());
    }
    api.set({
      bpm: args.bpm, offset: args.offset, volume: args.volume,
      fadeIn: args.fadeIn, fadeOut: args.fadeOut, loop: args.loop, grid: args.grid
    });
    if (args.enabled !== undefined) window.SFX_API.musicOn(!!args.enabled);
    const st = api.status();
    if (!st.track || st.track === 'none') return 'no track loaded yet — the human can upload one, or call set_music({generate:true}) to synthesise a beat. Settings saved: ' + JSON.stringify(st);
    return JSON.stringify(st);
  },
  beat_map(args) {
    if (toolHidden('beat_map')) return 'beat_map is switched off while music is OFF.';
    const m = window.MUSIC_API.map();
    const lim = Math.max(1, Math.min(200, +(args && args.limit) || 24));
    return JSON.stringify({ bpm: m.bpm, beat: m.beat, offset: m.offset, count: m.count,
      first_beats: m.beats.slice(0, lim), scenes: m.scenes });
  },
  find_tools(args) {
    const q = String((args && args.q) || '').toLowerCase().trim();
    const cat = toolCatalog();
    if (!cat.length) return 'every tool is already loaded.';
    const hit = q ? cat.filter(t => (t.name + ' ' + t.about).toLowerCase().indexOf(q) >= 0) : cat;
    if (!hit.length) return 'nothing matches “' + q + '”. Available to unlock: ' + cat.map(t => t.name).join(', ');
    hit.forEach(t => activateTool(t.name));
    return 'unlocked: ' + hit.map(t => t.name).join(', ') + ' — call them directly on your next step.';
  },
  /* ---------- history / scene surgery / layout QA ---------- */
  undo() { return window.TOOLBOX.undo(); },
  redo() { return window.TOOLBOX.redo(); },
  snapshot(args) {
    const name = (args && args.name) || ('snap ' + (window.TOOLBOX.snaps().length + 1));
    const names = window.TOOLBOX.snap(name);
    return 'snapshot “' + name + '” saved. Restore with restore_snapshot({name}). Have: ' + names.join(', ');
  },
  restore_snapshot(args) {
    const name = args && args.name;
    if (!name) return 'need {name} — call snapshot({name}) first';
    const r = window.TOOLBOX.restore(name);
    noteRead();
    return r ? 'restored “' + name + '”.' : 'no snapshot called “' + name + '”. Have: ' + window.TOOLBOX.snaps().join(', ');
  },
  duplicate_scene(args) {
    args = args || {};
    if (!args.id) return 'need {id} — the scene id';
    const r = window.TOOLBOX.dupScene(args.id, args.at);
    return r ? JSON.stringify(r) : 'no scene with id ' + args.id;
  },
  move_scene(args) {
    args = args || {};
    if (!args.id || args.to === undefined) return 'need {id, to}';
    const r = window.TOOLBOX.moveScene(args.id, args.to);
    return r ? JSON.stringify({ order: r }) : 'no scene with id ' + args.id;
  },
  split_scene(args) {
    args = args || {};
    if (!args.id || args.at === undefined) return 'need {id, at} — at = seconds into that scene';
    const r = window.TOOLBOX.splitScene(args.id, args.at);
    return typeof r === 'string' ? r : JSON.stringify(r);
  },
  duplicate_element(args) {
    args = args || {};
    if (!args.id) return 'need {id}';
    const r = window.TOOLBOX.dupElement(args.id, args.toScene);
    return r ? 'duplicated as ' + r : 'no element with id ' + args.id;
  },
  set_format(args) {
    const fmt = args && args.format;
    const r = window.TOOLBOX.setFormat(fmt);
    return r ? JSON.stringify(r) + ' — element positions were re-fitted' : 'need {format:"9:16"|"16:9"|"1:1"}';
  },
  fit_duration(args) {
    const sec = args && (args.seconds !== undefined ? args.seconds : args.duration);
    if (sec === undefined) return 'need {seconds}';
    return JSON.stringify(window.TOOLBOX.fitDuration(sec));
  },
  audit() {
    const r = window.TOOLBOX.audit();
    return JSON.stringify(r).slice(0, 2600);
  },
  /* ---------- sound effects ---------- */
  sfx(args) {
    args = args || {};
    const api = window.SFX_API;
    const act = args.action || 'list';
    if (act === 'list') {
      const l = api.list();
      return JSON.stringify({ count: l.length, on: l.filter(s => s.on).length,
        sounds: l, types: api.types });
    }
    if (act === 'clear') { api.clear(); return 'all sound effects removed.'; }
    if (act === 'auto') { const n = api.auto({ beat: args.beat !== false }); return 'placed ' + n + ' sound effect(s): a whoosh on every cut, a pop/swipe on each first animation, a tik on each cut when music is on.'; }
    if (act === 'toggle') {
      const s = api.toggle(args.id, args.on);
      return s ? JSON.stringify({ id: s.id, type: s.type, t: +s.t.toFixed(2), on: s.on }) : 'no sound with id ' + args.id;
    }
    if (act === 'add') {
      if (!args.type) return 'need {type:' + api.types.join('|') + ', t}';
      const s = api.add(args.type, +args.t || 0, args.gain);
      return JSON.stringify({ added: s.id, type: s.type, t: +s.t.toFixed(2), gain: s.gain, on: true });
    }
    return 'unknown action “' + act + '” — use list / add / toggle / clear / auto.';
  },
  /* ---------- fonts ---------- */
  list_fonts() {
    const used = {};
    SPEC.scenes.forEach(sc => (sc.elements || []).forEach(el => { if (el.family) used[el.family] = (used[el.family] || 0) + 1; }));
    return JSON.stringify({ families: window.MUSIC_API.fonts(), used_in_project: used });
  },
  set_font(args) {
    args = args || {};
    const ids = Array.isArray(args.ids) ? args.ids : (args.id ? [args.id] : []);
    if (!ids.length) return 'need {ids:[...]} (or {id})';
    const patch = {};
    ['family', 'weight', 'size', 'ls'].forEach(k => { if (args[k] !== undefined) patch[k] = args[k]; });
    if (!Object.keys(patch).length) return 'need at least one of family / weight / size / ls';
    if (patch.family && window.MUSIC_API.fonts().indexOf(String(patch.family)) < 0)
      return 'unknown family “' + patch.family + '”. Available: ' + window.MUSIC_API.fonts().join(', ');
    const n = window.MUSIC_API.setFont(ids, patch);
    noteWrite();
    return 'font updated on ' + n + ' element(s): ' + JSON.stringify(patch);
  }
};
const TOOL_HELP = {
  get_project: 'Read the current project (format, fps, duration, frame count, scenes, elements).',
  media_info: 'Metadata of the uploaded clip: size, duration, estimated frames.',
  count_frames: 'Decode the uploaded clip and count its real frames, fps and size.',
  grab_frame: 'Render one moment to a PNG file (and show it in the chat) with palette stats.',
  list_skill_files: 'List the skill pack Markdown files.',
  read_skill: 'Read one skill pack Markdown file verbatim.',
  replace_spec: 'Build a complete new video from a spec.',
  apply_ops: 'Edit the current video with ops (set/hide/show/retime/scene_bg/del_scene/add_scene).',
  set_playhead: 'Move the playhead to a time in seconds.',
  export_video: 'Record and download the finished video (real time, takes the video duration).',
  export_poster: 'Download the current frame as a poster PNG.',
  check_code: 'Compile + run a code element\'s js once and report any error before you ship it. Args: {js, t?}.',
  verify_video: 'Render 6 frames across the whole timeline and report code errors, blank frames and palette per scene.',
  add_element: 'Append ONE element to a scene. Args: {sceneId, element}.',
  set_text: 'Change the words of a text element. Args: {id, text}.',
  remove_element: 'Delete one element (or one scene child like "s1.e2.t"). Args: {id}.',
  todo_write: 'Create/update the task list for this run. Args: {items:[{text,status:pending|in_progress|completed}]}.',
  find_elements: 'Search the project for elements by text, id, type or code. Args: {q}.',
  critique: 'Spawn a fresh critic (isolated context) that reviews the project and returns max 8 bullets of concrete fixes. Args: {focus?}.',
  set_style: 'Save the design system you are using (palette, fonts, rules) into the project so every scene and follow-up keeps it. Args: {style}.',
  set_music: 'Music + beat. Args: {bpm?, offset?, volume?, fadeIn?, fadeOut?, loop?, grid?, clear?, generate?, style?(pop|house|minimal), duration?, enabled?}. generate:true synthesises a beat track yourself (do this instead of asking for a file); enabled:false mutes the music while keeping the beat grid.',
  beat_map: 'Return the beat times for the current BPM plus which beat each scene starts on, so cuts land on the music. Args: {limit?}.',
  undo: 'Step back one edit. Use it when a change made the video worse.',
  redo: 'Step forward again after an undo.',
  snapshot: 'Save a named checkpoint before a risky rewrite. Args: {name}.',
  restore_snapshot: 'Go back to a named checkpoint. Args: {name}.',
  duplicate_scene: 'Clone a scene (and its elements) to repeat a beat. Args: {id, at?}.',
  move_scene: 'Reorder scenes. Args: {id, to} — to is a 0-based index.',
  split_scene: 'Cut one scene in two at a moment. Args: {id, at} — at is seconds into that scene.',
  duplicate_element: 'Clone one element, optionally into another scene. Args: {id, toScene?}.',
  set_format: 'Change the aspect ratio (9:16 / 16:9 / 1:1) and re-fit every element. Args: {format}.',
  fit_duration: 'Scale every scene so the whole video is exactly N seconds. Args: {seconds}.',
  audit: 'Layout QA from the rendered frames AND the spec: art cut off by the frame edge, drift past the 40px margin, boxes that overlap as drawn, tiny text, crowded/blank scenes, unreadable pacing. Read this before you export; every item names the element id and the fix.',
  find_tools: 'Unlock extra tools that are not loaded yet. Args: {q} — pass a keyword (music, font, sound, frame, code, critic, poster, style, playhead) or nothing to list them all.',
  sfx: 'Sound effects. Args: {action:list|add|toggle|clear|auto, type?:pop|click|whoosh|ding|riser|boom|tik|chime|swipe, t?, gain?, id?, on?, beat?}. list also shows which sounds are switched off.',
  list_fonts: 'List the font families the project can use and which ones are already in use.',
  set_font: 'Set family / weight / size / letter-spacing on text elements. Args: {ids:[...], family?, weight?, size?, ls?}.'
};
function toolSchema() {
  const spec = { type: 'object', properties: {}, required: [] };
  return Object.keys(TOOL_IMPL).filter(name => !toolHidden(name) && isActiveTool(name)).map(name => ({
    type: 'function',
    function: {
      name,
      description: TOOL_HELP[name] || name,
      parameters: name === 'grab_frame' ? { type: 'object', properties: { time: { type: 'number', description: 'seconds' } }, required: ['time'] }
        : name === 'read_skill' ? { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        : name === 'set_playhead' ? { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] }
        : name === 'replace_spec' ? { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] }
        : name === 'apply_ops' ? { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } } }, required: ['ops'] }
        : name === 'check_code' ? { type: 'object', properties: { js: { type: 'string' }, t: { type: 'number' } }, required: ['js'] }
        : name === 'add_element' ? { type: 'object', properties: { sceneId: { type: 'string' }, element: { type: 'object' } }, required: ['sceneId', 'element'] }
        : name === 'set_text' ? { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] }
        : name === 'remove_element' ? { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
        : name === 'set_style' ? { type: 'object', properties: { style: { type: 'object' } }, required: ['style'] }
        : name === 'todo_write' ? { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } } } } }, required: ['items'] }
        : name === 'find_elements' ? { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
        : name === 'critique' ? { type: 'object', properties: { focus: { type: 'string' } }, required: [] }
        : name === 'set_music' ? { type: 'object', properties: {
            bpm: { type: 'number' }, offset: { type: 'number' }, volume: { type: 'number' }, enabled: { type: 'boolean' },
            fadeIn: { type: 'number' }, fadeOut: { type: 'number' }, loop: { type: 'boolean' },
            grid: { type: 'boolean' }, clear: { type: 'boolean' }, generate: { type: 'boolean' },
            style: { type: 'string', enum: ['pop', 'house', 'minimal'] }, duration: { type: 'number' } }, required: [] }
        : name === 'beat_map' ? { type: 'object', properties: { limit: { type: 'number' } }, required: [] }
        : name === 'find_tools' ? { type: 'object', properties: { q: { type: 'string' } }, required: [] }
        : name === 'snapshot' ? { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        : name === 'restore_snapshot' ? { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        : name === 'duplicate_scene' ? { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' } }, required: ['id'] }
        : name === 'move_scene' ? { type: 'object', properties: { id: { type: 'string' }, to: { type: 'number' } }, required: ['id', 'to'] }
        : name === 'split_scene' ? { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' } }, required: ['id', 'at'] }
        : name === 'duplicate_element' ? { type: 'object', properties: { id: { type: 'string' }, toScene: { type: 'string' } }, required: ['id'] }
        : name === 'set_format' ? { type: 'object', properties: { format: { type: 'string', enum: ['9:16', '16:9', '1:1'] } }, required: ['format'] }
        : name === 'fit_duration' ? { type: 'object', properties: { seconds: { type: 'number' }, duration: { type: 'number' } }, required: [] }
        : name === 'sfx' ? { type: 'object', properties: {
            action: { type: 'string', enum: ['list', 'add', 'toggle', 'clear', 'auto'] },
            type: { type: 'string' }, t: { type: 'number' }, gain: { type: 'number' },
            id: { type: 'string' }, on: { type: 'boolean' }, beat: { type: 'boolean' } }, required: [] }
        : name === 'set_font' ? { type: 'object', properties: {
            ids: { type: 'array', items: { type: 'string' } }, id: { type: 'string' },
            family: { type: 'string' }, weight: { type: 'number' }, size: { type: 'number' }, ls: { type: 'number' } }, required: [] }
        : spec
    }
  }));
}

