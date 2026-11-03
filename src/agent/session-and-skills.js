/* Agent session, credentials, chat UI, skill selection and system prompt. Extracted from original/source.html lines 2921-3368. */
/* ============================================================
   DEEPSEEK AGENT — streaming chat + tool loop + video engine
   ============================================================ */
/* ---------- secrets ----------
   The key is NEVER written into this file, never into the spec, never into a
   tool result, never into the chat. It arrives at runtime, in this order:
     1. window.AIVA_SECRETS.deepseek   (injected by a host page or a test harness)
     2. ?key=sk-… on the URL           (handy for a local launcher, stripped from history)
     3. the password field, kept in localStorage only if "remember key" is ticked
   Everything that can show text to the model passes through redact() first. */
const KEY_STORE = 'aiva_key', BASE_STORE = 'aiva_base', MODEL_STORE = 'aiva_model';
const THINK_STORE = 'aiva_think', TOOLS_STORE = 'aiva_tools';
const CHAT = [];
let BUSY = false, ABORT = null;
let SESSION_TOKENS = { in: 0, out: 0, total: 0, cached: 0 };
const $ = id => document.getElementById(id);

/* ---------- persisted settings ---------- */
(function restoreSettings() {
  try {
    $('apiKey').value = localStorage.getItem(KEY_STORE) || (window.AIVA_SECRETS && window.AIVA_SECRETS.deepseek) || '';
    $('rememberKey').checked = localStorage.getItem(KEY_STORE + '_remember') !== '0';
    const base = localStorage.getItem(BASE_STORE) || 'https://api.deepseek.com';
    $('baseUrl').value = base;
    const model = localStorage.getItem(MODEL_STORE) || 'deepseek-v4-flash';
    ensureModelOption(model);
    $('model').value = model;
    $('thinking').value = localStorage.getItem(THINK_STORE) || 'auto';
    $('useTools').checked = localStorage.getItem(TOOLS_STORE) !== '0';
  } catch (e) {}
})();
function ensureModelOption(id) {
  if (!id || [...$('model').options].some(o => o.value === id)) return;
  const o = document.createElement('option');
  o.value = id; o.textContent = id + ' (from /models)';
  $('model').insertBefore(o, $('model').firstChild);
}
$('btnForgetKey').onclick = () => { SECRETS.clear(); agentStatus('Key wiped from this browser.'); };
$('rememberKey').onchange = () => {
  try { localStorage.setItem(KEY_STORE + '_remember', $('rememberKey').checked ? '1' : '0'); } catch (e) {}
  if (!$('rememberKey').checked) { try { localStorage.removeItem(KEY_STORE); } catch (e) {} }
};
$('btnSaveKey').onclick = () => {
  try {
    SECRETS.set($('apiKey').value);
    localStorage.setItem(BASE_STORE, $('baseUrl').value.trim());
    localStorage.setItem(MODEL_STORE, $('model').value);
    localStorage.setItem(THINK_STORE, $('thinking').value);
    localStorage.setItem(TOOLS_STORE, $('useTools').checked ? '1' : '0');
    agentStatus('API key saved in this browser.');
  } catch (e) { agentStatus('Could not store the key (private mode?).'); }
};
$('model').onchange = () => { try { localStorage.setItem(MODEL_STORE, $('model').value); } catch (e) {} };
$('thinking').onchange = () => { try { localStorage.setItem(THINK_STORE, $('thinking').value); } catch (e) {} };
$('useTools').onchange = () => { try { localStorage.setItem(TOOLS_STORE, $('useTools').checked ? '1' : '0'); } catch (e) {} };
function agentStatus(t) { $('agentStatus').textContent = t || ''; }
function apiBase() { return ($('baseUrl').value.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''); }
const SECRET_MEM = { deepseek: '' };
const SECRETS = {
  fromHost() { try { return (window.AIVA_SECRETS && window.AIVA_SECRETS.deepseek) || ''; } catch (e) { return ''; } },
  fromUrl() {
    try {
      const k = new URLSearchParams(location.search).get('key');
      if (k) { history.replaceState(null, '', location.pathname); return k.trim(); }
    } catch (e) {}
    return '';
  },
  stored() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } },
  get() { return SECRET_MEM.deepseek || this.fromHost() || this.fromUrl() || ($('rememberKey') && $('rememberKey').checked ? this.stored() : '') || ''; },
  set(v) {
    SECRET_MEM.deepseek = String(v || '').trim();
    try {
      if ($('rememberKey') && $('rememberKey').checked) localStorage.setItem(KEY_STORE, SECRET_MEM.deepseek);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) {}
  },
  clear() {
    SECRET_MEM.deepseek = '';
    $('apiKey').value = '';
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
  },
  has() { return !!this.get(); }
};
/* anything leaving for the model or the screen goes through here */
function redact(s) {
  let t = String(s === undefined ? '' : s);
  const k = SECRET_MEM.deepseek || SECRETS.stored();
  if (k && k.length > 8) t = t.split(k).join('sk-***');
  return t.replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***');
}
function apiKey() { return SECRETS.get() || $('apiKey').value.trim(); }

/* live model ids straight from the API */
$('btnModels').onclick = async () => {
  const key = apiKey();
  if (!key) { agentStatus('Paste the key first, then press ↻.'); return; }
  agentStatus('Loading models…');
  try {
    const res = await fetch(apiBase() + '/models', { headers: { Authorization: 'Bearer ' + key } });
    const raw = await res.text();
    if (!res.ok) throw new Error('API ' + res.status + ': ' + raw.slice(0, 160));
    const list = (JSON.parse(raw).data || []).map(m => m.id);
    list.forEach(ensureModelOption);
    agentStatus(list.length + ' model ids: ' + list.join(', '));
  } catch (e) { agentStatus('Could not list models — ' + (e.message || e)); }
};

/* ---------- token counter ---------- */
const LAST_CTX = { prompt: 0, cached: 0 };
function addUsage(u) {
  if (!u) return;
  LAST_CTX.prompt = u.prompt_tokens || LAST_CTX.prompt;
  LAST_CTX.cached = u.prompt_cache_hit_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  SESSION_TOKENS.in += u.prompt_tokens || 0;
  SESSION_TOKENS.out += u.completion_tokens || 0;
  SESSION_TOKENS.total += u.total_tokens || 0;
  SESSION_TOKENS.cached += (u.prompt_cache_hit_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0);
  const el = $('usage');
  const hit = SESSION_TOKENS.in ? Math.round(SESSION_TOKENS.cached / SESSION_TOKENS.in * 100) : 0;
  const ctx = LAST_CTX.prompt || 0;
  const pct = ctx ? Math.round(ctx / MODEL_WINDOW * 100) : 0;
  el.textContent = SESSION_TOKENS.total
    ? SESSION_TOKENS.total.toLocaleString() + ' tok' + (hit ? ' · ' + hit + '% cached' : '') +
      (ctx ? ' · ctx ' + (ctx / 1000).toFixed(1) + 'k/' + Math.round(MODEL_WINDOW / 1000) + 'k (' + pct + '%)' : '')
    : '— tok';
  el.title = 'session input ' + SESSION_TOKENS.in + ' · output ' + SESSION_TOKENS.out +
    ' · cached ' + SESSION_TOKENS.cached + ' (' + hit + '%)' +
    ' · this request: ' + ctx + ' prompt tokens (' + pct + '% of the window, compaction at 60%)';
  el.title = 'this session · in ' + SESSION_TOKENS.in.toLocaleString() +
    ' · out ' + SESSION_TOKENS.out.toLocaleString() +
    (SESSION_TOKENS.cached ? ' · cached ' + SESSION_TOKENS.cached.toLocaleString() : '');
}
function usageLine(u) {
  if (!u) return '';
  const cached = u.prompt_cache_hit_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  return 'in ' + (u.prompt_tokens || 0) + ' · out ' + (u.completion_tokens || 0) +
    ' · total ' + (u.total_tokens || 0) + (cached ? ' · cached ' + cached : '');
}

/* ---------- chat rendering (with live bubbles) ---------- */
function pushMsg(role, text, kind) {
  CHAT.push({ role, content: text });
  const el = document.createElement('div');
  el.className = 'msg ' + (kind || (role === 'user' ? 'user' : 'bot'));
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = role === 'user' ? 'you' : (role === 'assistant' ? 'agent' : 'system');
  el.appendChild(tag);
  const body = document.createElement('div');
  body.className = 'mbody';
  body.textContent = text;
  el.appendChild(body);
  $('chat').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}
function sysNote(t) { const el = pushMsg('system', t, 'sys'); CHAT.pop(); return el; }

function beginBotBubble() {
  const el = document.createElement('div');
  el.className = 'msg bot';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'agent';
  el.appendChild(tag);
  const usage = document.createElement('div');
  usage.className = 'usage';
  el.appendChild(usage);
  $('chat').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return { el, usage };
}

/* one block per model step, so thinking / tool rows / answers read in order */
function beginStep(bubble) {
  const step = document.createElement('div');
  step.className = 'step';
  const think = document.createElement('div');
  think.className = 'think';
  think.style.display = 'none';
  think.innerHTML = '<b>thinking</b>';
  const thinkBody = document.createElement('div');
  think.appendChild(thinkBody);
  const body = document.createElement('div');
  body.className = 'mbody';
  step.appendChild(think);
  step.appendChild(body);
  bubble.el.insertBefore(step, bubble.usage);
  return { step, think, thinkBody, body };
}

function addToolRow(el, name, argsText) {
  const row = document.createElement('div');
  row.className = 'tool';
  row.innerHTML = '<span class="tname">🔧 ' + name + '</span><span class="targs"></span>';
  const at = argsText ? String(argsText) : '';
  row.querySelector('.targs').textContent = at ? ' ' + (at.length > 160 ? at.slice(0,160) + '…' : at) : '';
  const res = document.createElement('div');
  res.className = 'tres';
  res.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.appendChild(row);
  wrap.appendChild(res);
  el.appendChild(wrap);
  $('chat').scrollTop = $('chat').scrollHeight;
  return res;
}
$('btnCompact').onclick = async () => {
  if (BUSY) return;
  const msgs = [{ role: 'system', content: systemPrompt() }].concat(CHAT.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10).map(m => ({ role: m.role, content: m.content })));
  if (msgs.length < 4) { pushMsg('assistant', 'Nothing to compact yet — the session is short.'); return; }
  $('btnCompact').disabled = true;
  try {
    const out = await compactHistory(msgs);
    const note = out[1] && out[1].content || '';
    pushMsg('assistant', 'Session compacted. Handover note:\n' + note.replace(/^\[compacted[^\]]*\]\n/, '').slice(0, 1200));
    addNote(null, 'compacted by hand: ' + msgs.length + ' messages → ' + out.length);
  } catch (e) { pushMsg('assistant', 'Compact failed: ' + e.message); }
  $('btnCompact').disabled = false;
};
$('btnClearChat').onclick = () => {
  CHAT.length = 0; $('chat').innerHTML = '';
  TODOS = [];
  try { resetActiveTools(); } catch (e) {} TODO_EL = null;
  READ_BEAT = 0; WRITE_BEAT = 0;
  SESSION_TOKENS = { in: 0, out: 0, total: 0, cached: 0 }; addUsage(null); $('usage').textContent = '— tok';
  sysNote('Chat cleared (the video on the right stays).');
};

/* ---------- the skill pack (embedded verbatim) ---------- */
const SKILL_FILES = window.SKILL_FILES || {};
const SKILL_ORDER = window.SKILL_ORDER || Object.keys(SKILL_FILES);
const SKILL_KEY = 'aiva_skill_files', SKILL_ALL_KEY = 'aiva_skill_all';
const SKILL_DEFAULT = [
  'video-generation/SKILL.md',
  'video-generation/workflows/motion-graphics.md',
  'video-generation/references/motion-graphics.md'
].filter(f => SKILL_FILES[f]);
let SKILL_SENT = SKILL_DEFAULT.slice();
let SKILL_ALL = false;
/* Claude-Code trick: CLAUDE.md as an INDEX. The 24 files are ~200 KB; sending
   three of them on every request costs ~5k tokens for text the model may not
   need. Index mode sends one line per file and lets read_skill() fetch the
   body only when the task actually calls for it. */
let SKILL_INDEX_ONLY = true;
try { SKILL_INDEX_ONLY = localStorage.getItem('aiva_skill_index') !== '0'; } catch (e) {}
try {
  const saved = JSON.parse(localStorage.getItem(SKILL_KEY) || 'null');
  if (Array.isArray(saved) && saved.length) SKILL_SENT = saved.filter(f => SKILL_FILES[f]);
  SKILL_ALL = localStorage.getItem(SKILL_ALL_KEY) === '1';
} catch (e) {}
function saveSkillSel() {
  try {
    localStorage.setItem(SKILL_KEY, JSON.stringify(SKILL_SENT));
    localStorage.setItem(SKILL_ALL_KEY, SKILL_ALL ? '1' : '0');
  } catch (e) {}
}
function shortName(p) { return p.replace(/^video-generation\//, '').replace(/\.md$/, ''); }
function renderSkillList() {
  const box = $('skillList');
  if (!box) return;
  box.innerHTML = '';
  SKILL_ORDER.forEach(path => {
    const row = document.createElement('label');
    row.className = 'skillRow';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = SKILL_ALL || SKILL_SENT.indexOf(path) >= 0;
    cb.disabled = SKILL_ALL;
    cb.onchange = () => {
      const i = SKILL_SENT.indexOf(path);
      if (cb.checked && i < 0) SKILL_SENT.push(path);
      if (!cb.checked && i >= 0) SKILL_SENT.splice(i, 1);
      saveSkillSel(); updateSkillCount();
    };
    row.appendChild(cb);
    const name = document.createElement('span');
    name.textContent = shortName(path);
    row.appendChild(name);
    const view = document.createElement('button');
    view.className = 'view';
    view.textContent = 'read';
    view.onclick = ev => { ev.preventDefault(); showSkill(path); };
    row.appendChild(view);
    box.appendChild(row);
  });
  $('skillAll').checked = SKILL_ALL;
  updateSkillCount();
}
function updateSkillCount() {
  const names = SKILL_ALL ? SKILL_ORDER : SKILL_SENT;
  const chars = names.reduce((n, f) => n + (SKILL_FILES[f] || '').length, 0);
  if (SKILL_INDEX_ONLY && !SKILL_ALL) {
    const idx = skillIndexText().length;
    $('skillCount').textContent = '· index only · ' + SKILL_ORDER.length + ' files · ' +
      Math.round(idx / 1024) + ' KB (was ' + Math.round(chars / 1024) + ' KB) · read on demand';
  } else {
    $('skillCount').textContent = '· ' + names.length + '/' + SKILL_ORDER.length + ' files · ' +
      Math.round(chars / 1024) + ' KB sent' + (chars > 120000 ? ' ⚠ may exceed the model context' : '');
  }
}
function showSkill(path) {
  const v = $('skillView');
  if (v.dataset.path === path && v.classList.contains('on')) { v.classList.remove('on'); v.dataset.path = ''; return; }
  v.dataset.path = path;
  v.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = path;
  v.appendChild(h);
  v.appendChild(document.createTextNode(SKILL_FILES[path] || '(missing)'));
  v.classList.add('on');
}
$('skillAll').onchange = e => { SKILL_ALL = e.target.checked; saveSkillSel(); renderSkillList(); };
const smb = $('skillModeBox');
if (smb) {
  smb.checked = SKILL_INDEX_ONLY && !SKILL_ALL;
  smb.onchange = e => {
    SKILL_INDEX_ONLY = e.target.checked;
    if (SKILL_INDEX_ONLY) { SKILL_ALL = false; $('skillAll').checked = false; }
    try { localStorage.setItem('aiva_skill_index', SKILL_INDEX_ONLY ? '1' : '0'); } catch (err) {}
    saveSkillSel(); renderSkillList();
  };
}
renderSkillList();
function skillLine(path) {
  const body = SKILL_FILES[path] || '';
  const h = body.match(/^#\s+(.+)$/m);
  const first = body.replace(/\s+/g, ' ').trim();
  const desc = (h ? h[1] : first).slice(0, 90);
  return '· ' + path + ' — ' + desc + ' (' + Math.round(body.length / 1024) + ' KB)';
}
function skillIndexText() {
  return '\n===== SKILL PACK INDEX (' + SKILL_ORDER.length + ' files, read with read_skill({path})) =====\n' +
    SKILL_ORDER.map(skillLine).join('\n');
}
function skillText() {
  if (SKILL_INDEX_ONLY && !SKILL_ALL) return skillIndexText();
  const names = SKILL_ALL ? SKILL_ORDER.slice() : SKILL_SENT.slice();
  return names.map(n => '\n===== SKILL FILE: ' + n + ' =====\n' + SKILL_FILES[n]).join('\n');
}

/* ---------- system prompt ---------- */
function systemPrompt() {
  return [
    'You are the video agent inside a single-page canvas video editor. You work in a LOOP: you may call tools as many times as you need, look at what they return, and only then answer.',
    '',
    ...(SKILL_INDEX_ONLY && !SKILL_ALL
      ? ['The SKILL PACK is indexed below (file, one-line summary, size) — it is the human\'s own playbook, kept verbatim. Open the two or three files that match this brief with read_skill({path}) BEFORE you design; the index is a menu, not the manual. Follow its workflow, story rules, motion-graphics guidance and verification habits. Your only departure is that you cannot call FFmpeg or image/video models here — you drive the deterministic canvas engine described next, and you have the tools listed after it.']
      : ['Below is the SKILL PACK in full, verbatim, exactly as the human wrote it. Follow its workflow, story rules, motion-graphics guidance and verification habits. Your only departure is that you cannot call FFmpeg or image/video models here — you drive the deterministic canvas engine described second, and you have the tools listed third.']),
    '',
    SKILL_INDEX_ONLY && !SKILL_ALL ? '===================== SKILL PACK INDEX =====================' : '===================== SKILL PACK (verbatim) =====================',
    skillText(),
    '=================== END OF SKILL PACK ===================',
    '',
    '===================== THE ENGINE YOU CONTROL =====================',
    'There is NO template, NO demo scene and NO stock art inside this page. The project opens EMPTY and you author every single scene yourself, from the skill pack.',
    'Canvas: whatever format the project is set to (9:16 1080x1920, 16:9 1920x1080 or 1:1 1080x1080) at 30 fps — get_project() tells you which; the live state is appended to every turn. Keep important art inside a 90px safe margin.',
    'ART DIRECTION IS YOURS. Nothing about the look is prescribed: not the palette, not the typeface, not the outline weight, not the layout, not the number of scenes. Read the brief and design this video from zero, the way you would for a new client.',
    'Do NOT reproduce the example reel in the skill pack, this page\'s old demo, or the last video you made — those are references for the method, not a style to copy. If the human asks for a specific look, follow it exactly; if they do not, choose one deliberately and keep it consistent across scenes.',
    'Typefaces you can actually use: "Baloo" and "Fredoka" (both inlined), or any generic family: sans-serif, serif, monospace, cursive, system-ui. Set it per text element with "family".',
    'H.P / H.PAL is only a convenience palette (it happens to hold the paper/coral/teal group); use it, change the hex codes, or ignore it completely — your choice, per brief.',
    'SPEC: {"format":"9:16","style":{"palette":["#..."],"fonts":["..."],"rules":"..."},"scenes":[{"id":"s1","name":"Hook","dur":2.5,"bg":"#F1F7FF","elements":[ ... ]}]}',
    '"style" is YOUR design system for this project: decide it first, save it with set_style, and keep every scene (and every follow-up edit) inside it. get_project() gives it back to you.',
    '',
    'THE WHOLE ENGINE IS TWO ELEMENT TYPES: "text" and "code". There are no buttons, cards, badges, bubbles, stars, arrows, logos or icons built in — you build every one of them yourself with drawing code.',
    '',
    'A) {"type":"text", ...} — the only word renderer; the human can click a single letter and edit it:',
    '  {"type":"text","text":"HELLO","x":540,"y":800,"size":120,"color":"#16161F","align":"center","ls":0,"family":"sans-serif","outline":0,"weight":800,"anim":"pop","delay":0.1}',
    '  align "left"|"center"|"right" · ls letter-spacing px · family any font (see above) · outline 0..1 dark outline · weight 600|700|800 · \\n starts a new line.',
    '  Text auto-shrinks to stay inside the frame ("margin" default 90px; "fit":false disables it). Keep lines short anyway — one idea per line reads better than a shrunk sentence.',
    '',
    'B) {"type":"code","label":"…","x":..,"y":..,"w":..,"h":..,"js":"…"} — you write the drawing code:',
    '  "js" runs every frame with: ctx (already translated to the element centre), e (the element, so e.text/e.color/e.label work as your data), H (helper), t (seconds into the scene), dur (scene length), w/h (element box).',
    '  H surface: H.P (palette object), H.PAL (array), H.INK; H.circle(x,y,r), H.rr(x,y,w,h,r), H.star(x,y,R,r,n), H.star4(x,y,R,r), H.poly([[x,y],...]);',
    '    H.ink(pathFn, fill, lw) (fills + thick ink outline), H.fill(pathFn,color), H.stroke(pathFn,color,lw);',
    '    H.setFont(size,weight,family,ls) + ctx.fillText for words, or H.text(str,x,y,{size,color,weight,align,outline,ls});',
    '    H.mix(c1,c2,k), H.clamp/H.lerp, easings H.eOut/H.eIn/H.eOutBack/H.eOutExpo/H.sp/H.beatEnv, H.rnd(i) (deterministic noise), H.reg(x,y,w,h).',
    '  Build everything out of those primitives, e.g.:',
    '    button:  H.ink(()=>H.rr(-w/2,-h/2,w,h,h/2), e.color || "#222222", 12); H.text("GET IT", 0, 0, {size:54, color:"#FFFFFF"});',
    '    card:    H.ink(()=>H.rr(-w/2,-h/2,w,h,28), "#FFFFFF", 10); H.text("FAST", 0, -46, {size:56}); H.text("no lag", 0, 34, {size:32, color:"#5B5B6B"});',
    '    bubble:  H.ink(()=>{H.rr(-w/2,-h/2,w,h,44); H.poly([[w/2-70,h/2-6],[w/2+12,h/2+74],[w/2-124,h/2-6]]);}, "#FFFFFF", 12); H.text("Hi!", 0, 0, {size:52});',
    '    icon:    stack H.circle / H.rr / H.poly / H.star with H.ink until it looks like the object you want (rocket, phone, chart, clock, mascot — your own design).',
    '  Code must be deterministic (a function of t only: no Math.random, no Date, no network, no DOM) and must not call H.reg more than once — the whole box is already clickable.',
    '  Draw ONE object per code element (one icon, one badge, one doodle) so every part stays individually selectable, movable and hand-editable.',
    'C) scene art code — an optional "js" string on the SCENE itself, painted behind its elements with the origin at the top-left corner (0,0)-(W,H). Same H helper, same rules. Use it for backdrops, patterns, gradients, charts. The human can still select it as "Scene art (code)".',
    '  {"id":"s1","name":"Hook","dur":2.5,"bg":"#FFF3E3","js":"H.fill(()=>H.rr(60,60,960,1800,60), \'#FFE7C4\'); ...","elements":[ ... ]}',
    'anim: "pop" | "rise" | "slideL" | "slideR" | "fade" | "none" (+ "delay", "dur"). Element ids are "<sceneId>.e<index>" (0-based).',
    'Supported: ctx paths, fill/stroke, gradients, save/restore/translate/rotate/scale, globalAlpha, lineDash, clipping within your element box. No images from the internet — the page is offline.',
    '',
    '===================== HOW YOU WORK =====================',
    'You are not a chatbot that describes videos; you are an agent that builds them. Keep going until the job is done — never stop after a plan, never ask permission to do the obvious next step.',
    '1. PLAN FIRST. The moment a request needs more than one step, call todo_write with 3-6 concrete tasks (one in_progress, the rest pending). Keep exactly one in_progress. Mark a task completed the instant it is finished, not in a batch at the end. Rewrite the list when the work changes.',
    '2. READ BEFORE YOU REWRITE. Before you modify an existing element (set_text, apply_ops, remove_element) call get_project() first; the tools refuse edits made on a stale picture. New work (replace_spec, add_element) needs no read.',
    '3. BATCH. Independent tool calls go in the SAME turn (e.g. three add_element calls, or get_project + verify_video). Do not spend a turn per call.',
    '4. VERIFY AFTER EVERY CHANGE. verify_video() for structure and blank frames, grab_frame({time}) when you need the real pixel statistics, and the tool result already reports code errors for the frame. Fix what the report says before moving on.',
    '5. REVIEW BEFORE DELIVERY. Call critique() once the video is built, act on the bullets that matter, then export_video() if the human asked for the file.',
    '6. TOOL RESULTS ARE BUDGETED. Old results are cleared and long ones truncated; if you need a fact again, call the tool again instead of assuming. Keep your own writing short and concrete.',
    '7. NEVER GUESS IDS. find_elements({q}) searches texts, labels, types and code. Ids are "<sceneId>.e<index>".',
    '13. GEOMETRY IS CHECKED ON THE PIXELS, NOT ON YOUR NUMBERS. audit() and verify_video() re-draw five frames and read the quads the engine actually registered, so they catch art that is cut off by the frame edge, text that drifts into the 40px margin, and boxes that collide mid-animation. Treat every off_frame / overlaps entry as a bug with an id: move, shrink or re-time that element, then run audit() again.',
    '13. RECOVERY AND LAYOUT QA. Before a destructive rewrite call snapshot({name}); if an edit makes things worse, undo() instead of guessing. Read audit() before export_video() — it lists off-frame text, overlapping boxes, crowded scenes and unreadable pacing with the element ids to fix.',
    '8. SELF-CORRECTION. A tool error is information, not the end: read it, fix the cause, retry once. If the same call fails twice, change approach.',
    '9. SCRIPT TEXT. Sinhala, Tamil, Devanagari, Arabic, Thai and other complex scripts are drawn with real shaping (bundled Noto Sinhala) and the engine keeps a whole word in one text element. Write each line as ONE text element with the correct spelling — never split a word into pieces to fake letter animation, and never insert dotted circles or zero-width joiners by hand.',
    '11. SOUND. You make the music and the effects yourself: set_music({generate:true, bpm, style}) builds the beat, sfx({action:"auto"}) places a whoosh on every cut and a pop on the first animation, and sfx({action:"add", type, t}) places anything else from pop|click|whoosh|ding|riser|boom|tik|chime|swipe. Never ask the human for a music file. Both music and every single effect have an on/off switch that the human (and you, set_music({enabled:false}) / sfx({action:"toggle"})) can flip.',
    '12. TEXT MUST BE READABLE. The engine clips any outline to 10% of the font size, so small type with outline:10 still blobs — keep outline ≤ 0.08 × size, keep the colour ≥ 3:1 against the scene background, and read verify_video().low_contrast after every build; if it lists an element, fix its colour or its background before you export.',
    '10. MUSIC IS PART OF THE DESIGN. If the video has music, set it before you cut: set_music({bpm}) (or generate:true to synthesise a track), then beat_map() and place scene cuts and anim:"beat" punches on beats. Never leave a beat grid that does not match the cuts.',
    '',
    '===================== YOUR TOOLS =====================',
    'get_project()                      read format / fps / duration / frame count / scenes / elements with ids (+ music, fonts, any code errors)',
    'set_music({...})                   bpm / offset / volume / fades, or generate:true to synthesise a beat track for the whole video',
    'beat_map({limit?})                 beat times at the current BPM + which beat each scene starts on — cut on the music',
    'set_font({ids,family,weight,size,ls})  change the typeface of text elements; list_fonts() shows what exists',
    'check_code({js})                  compile + run a snippet once, tell you if it throws — use it before shipping code',
    'media_info()                      the uploaded clip: size, duration, fps, frame count',
    'count_frames()                    decode the uploaded clip and count its real frames',
    'grab_frame({time})                render that moment, save it as a PNG file, return size + palette',
    'list_skill_files() / read_skill({path})   the rest of the skill pack',
    'replace_spec({spec})              build a whole new video',
    'todo_write({items})              the task list for this run — use it on anything multi-step',
    'find_elements({q})               search elements by text / id / type / code',
    'critique({focus?})               a fresh critic reviews the project and returns max 8 concrete fixes',
    'add_element({sceneId, element})   add ONE element to a scene',
    'set_text({id, text})              reword a text element',
    'remove_element({id})              delete an element',
    'set_style({style})                write down your design system (palette, fonts, motion rules) in the project',
    'verify_video()                    render 6 frames across the timeline: code errors, blank frames, palette',
    'apply_ops({ops})                  edit the current video (set/hide/show/retime/scene_bg/del_scene/add_scene)',
    'set_playhead({time})              move the playhead so the human sees that frame',
    'export_video() / export_poster()  download the finished video / a poster PNG',
    '',
    'RULES: when the human asks for a video, your FIRST action is replace_spec with a complete spec — never reply with only a plan or a question, build it and then refine it in the loop.',
    'After you build, call verify_video() and fix whatever it reports (code errors, blank frames) before you answer.',
    'Never invent a template — the stage is empty and everything on it must come from you; think in the loop, call tools before guessing, keep answers short and concrete, and put the user-facing summary in plain text (no JSON needed when you use tools). If the human edits by hand afterwards, read get_project() again before your next change.'
  ].filter(line => {
    /* a tool that does not exist right now is not described to the model either */
    const t = String(line).trim();
    const m = t.match(/^([a-z_]+)\(/);
    if (m && (toolHidden(m[1]) || !isActiveTool(m[1]))) return false;
    if (hiddenTools().length && (/^10\. MUSIC IS PART/.test(t) || /^11\. SOUND\./.test(t))) return false;
    return true;
  }).concat(['',
    'MORE TOOLS (loaded on demand — call find_tools({q:"keyword"}) to unlock any of them for this session):',
    toolCatalog().map(t => t.name + ' — ' + t.about).join('\n') || '(all tools are loaded)'
  ]).concat(hiddenTools().length ? [
    'MUSIC IS OFF. The human switched music off, so set_music and beat_map do not exist in this session — do not create a beat, do not ask for a music file and do not plan cuts around a beat grid. Sound effects still work: sfx({action:"auto"}) places them, and every effect has an on/off switch. Everything else (visuals, text, export) is unchanged.',
    'TEXT MUST BE READABLE. The engine clips any outline to 5% of the font size, so small type with outline:10 still blobs — keep outline ≤ 0.08 × size, keep the colour ≥ 3:1 against the scene background, and read verify_video().low_contrast after every build; if it lists an element, fix its colour or its background before you export.'
  ] : []).join('\n');
}

