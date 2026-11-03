/* Model streaming, task list and context compaction. Extracted from original/source.html lines 3952-4189. */
/* ---------- streaming model call ---------- */
/* model routing (Claude-Code pattern): the expensive model thinks and plans,
   the cheap one grinds through the mechanical tool steps */
const MODEL_ROUTE_STORE = 'aiva_route';
const ROUTE_CHEAP = 'deepseek-v4-flash';
function cheapModel(picked) { return /pro|reasoner|opus|sonnet|gpt-5|large/.test(String(picked || '')) ? ROUTE_CHEAP : null; }
async function streamChat(messages, tools, onState, signal, toolChoice) {
  const picked = $('model').value;
  const model = (window.MODEL_OVERRIDE && $('modelRoute') && $('modelRoute').checked) ? window.MODEL_OVERRIDE : picked;
  const body = { model, messages, stream: true, stream_options: { include_usage: true }, temperature: 0.6 };
  const forced = !!(toolChoice && toolChoice !== 'auto');
  if (tools && tools.length) { body.tools = tools; body.tool_choice = toolChoice || 'auto'; }
  /* keep the answer short: a step that only calls tools does not need an essay */
  if (!body.max_tokens) body.max_tokens = 2400;
  const think = window.THINK_OVERRIDE || $('thinking').value;
  if (think === 'on') body.thinking = { type: 'enabled' };
  if (think === 'off') body.thinking = { type: 'disabled' };
  /* auto-heal: once a model has refused thinking once, stop asking it for the rest of the run */
  window.THINK_BLOCKED = window.THINK_BLOCKED || {};
  if (body.thinking && body.thinking.type === 'enabled' && window.THINK_BLOCKED[model]) body.thinking = { type: 'disabled' };
  /* a forced tool_choice and a thinking model are mutually exclusive on this API
     ("Thinking mode does not support this tool_choice"): the forced call wins */
  if (forced && body.thinking && body.thinking.type === 'enabled') body.thinking = { type: 'disabled' };

  const post = b => fetch(apiBase() + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
    body: JSON.stringify(b),
    signal
  });
  let res = await post(body);
  if (!res.ok) {
    let txt = await res.text();
    /* defensive: whatever combination the server refuses, degrade instead of failing
       1) thinking + tool_choice → drop thinking   2) still refused → relax tool_choice */
    /* any 400 that mentions thinking: the model either cannot think with tools,
       or cannot think with a forced call — drop thinking and go again */
    const clash = /think/i.test(txt);
    if (res.status === 400 && clash) {
      window.THINK_BLOCKED[model] = true;
      agentStatus(model + ' refuses thinking here — running it with thinking off.');
      const b2 = JSON.parse(JSON.stringify(body));
      delete b2.thinking;
      res = await post(b2);
      if (res.ok) { window.STEP_NOTE = 'thinking off (the API refuses thinking + a forced tool call)'; }
      else {
        txt = await res.text();
        const b3 = JSON.parse(JSON.stringify(body));
        delete b3.thinking; b3.tool_choice = 'auto';
        res = await post(b3);
        if (res.ok) { window.STEP_NOTE = 'tool_choice relaxed to auto (the API refuses thinking + a forced tool call)'; }
        else txt = await res.text();
      }
    }
    if (!res.ok) {
      const hint = /tool_choice/i.test(txt) ? ' — this model cannot combine thinking with a forced tool call; the page already disables thinking for forced calls, so switch think: auto or think: off for this run' : '';
      throw new Error('API ' + res.status + ': ' + redact(txt.slice(0, 300)) + hint);
    }
  }
  const acc = { content: '', reasoning: '', toolCalls: [], usage: null };
  if (!res.body) {                                  // no streaming -> plain JSON
    const j = JSON.parse(await res.text());
    const m = j.choices[0].message;
    acc.content = m.content || '';
    acc.reasoning = m.reasoning_content || '';
    acc.toolCalls = m.tool_calls || [];
    acc.usage = j.usage;
    onState(acc);
    return acc;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      if (j.usage) { acc.usage = j.usage; onState(acc); }
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      const d = ch.delta || {};
      if (d.reasoning_content) acc.reasoning += d.reasoning_content;
      if (d.content) acc.content += d.content;
      if (d.tool_calls) {
        d.tool_calls.forEach((tc, k) => {
          const idx = (tc.index === undefined) ? k : tc.index;
          let slot = acc.toolCalls[idx];
          if (!slot) slot = acc.toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) slot.id = tc.id;
          if (tc.function) {
            if (tc.function.name) slot.function.name = tc.function.name;
            if (tc.function.arguments) slot.function.arguments += tc.function.arguments;
          }
        });
      }
      onState(acc);
    }
  }
  acc.toolCalls = acc.toolCalls.filter(Boolean);
  return acc;
}

function tryJson(txt) {
  if (!txt) return null;
  let t = String(txt).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (t[0] !== '{') return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

/* ---------- task list (TodoWrite pattern) ---------- */
let TODOS = [];
let TODO_EL = null;
function renderTodos(todos) {
  if (!todos.length) { if (TODO_EL) TODO_EL.remove(); TODO_EL = null; return; }
  const done = todos.filter(t => t.status === 'completed').length;
  const html = '<b>plan · ' + done + '/' + todos.length + '</b>' + todos.map(t => {
    const icon = t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○';
    const cls = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'act' : '';
    return '<div class="it ' + cls + '"><span>' + icon + '</span><span>' + esc(t.text) + '</span></div>';
  }).join('');
  if (!TODO_EL) {
    TODO_EL = document.createElement('div');
    TODO_EL.className = 'todo';
    const host = document.querySelector('.msg.bot:last-of-type');
    if (host) host.insertBefore(TODO_EL, host.querySelector('.usage'));
  }
  TODO_EL.innerHTML = html;
  $('chat').scrollTop = $('chat').scrollHeight;
}
function addNote(host, text) {
  const d = document.createElement('div');
  d.className = 'tres';
  d.style.display = '';
  d.textContent = '⟳ ' + text;
  host.appendChild(d);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function esc(t) { return String(t === undefined ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function todoReminder() {
  if (!TODOS.length) return '';
  const now = TODOS.filter(t => t.status === 'in_progress').map(t => '“' + t.text + '”')[0] || 'none';
  const left = TODOS.filter(t => t.status !== 'completed').length;
  return '[todo list] ' + TODOS.map((t, i) => (i + 1) + '.' + (t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○') + ' ' + t.text).join(' · ') +
    '  → working on: ' + now + ' · ' + left + ' left. Mark a task completed the moment it is done.';
}

/* ---------- context budget (Claude-Code style) ---------- */
const FILE_READS = {};      // path -> times read (read-once policy for skill files)
const TOOL_KEEP = 4;        // last N tool results stay verbatim (was 6)
const TOOL_CAP = 3000;      // chars kept from any single tool result (was 6000)
/* the model's window, not a magic number: compaction fires at 60% of it */
const MODEL_WINDOW = 128000;
const COMPACT_AT = Math.round(MODEL_WINDOW * 0.6);

/* strip the noise out of a tool result before it enters the context: empty
   fields, long arrays, float hair. Claude Code does this in a PreToolUse hook;
   we do it at the one place every result passes through. */
function trimJson(v, depth) {
  depth = depth || 0;
  if (Array.isArray(v)) {
    const arr = v.slice(0, 8).map(x => trimJson(x, depth + 1));
    if (v.length > 8) arr.push('…+' + (v.length - 8) + ' more');
    return arr;
  }
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(k => {
      const val = v[k];
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) return;
      out[k] = trimJson(val, depth + 1);
    });
    return out;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 100) / 100;
  if (typeof v === 'string' && v.length > 400) return v.slice(0, 400) + '…';
  return v;
}
let LAST_RESULT = { key: '', content: '' };
function compactResult(name, argsRaw, out) {
  let s = String(out === undefined ? '' : out);
  const t = s.trim();
  if (t[0] === '{' || t[0] === '[') {
    try { s = JSON.stringify(trimJson(JSON.parse(t))); } catch (e) {}
  }
  s = s.replace(/[ \t]{2,}/g, ' ');
  const key = name + '(' + (argsRaw || '') + ')';
  if (key === LAST_RESULT.key && s === LAST_RESULT.content) return '[identical to your previous ' + name + ' result — nothing changed]';
  LAST_RESULT = { key, content: s };
  return s;
}

function pruneTools(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    seen++;
    if (seen > TOOL_KEEP) {
      const s = String(m.content);
      if (s.startsWith('[cleared')) continue;
      m.content = '[cleared] ' + s.slice(0, 80).replace(/\s+/g, ' ') + (s.length > 80 ? ' …' : '') +
        ' (' + s.length + ' chars dropped — call the tool again if you still need it)';
    }
  }
}
function stateLine() {
  const errs = Object.keys(window.CODE_ERRORS || {});
  return '[state] ' + SCENES.length + ' scene(s) · ' + DUR.toFixed(1) + 's · ' + Math.round(DUR * 30) +
    ' frames · ' + SPEC.format + ' · style: ' + (SPEC.style ? 'saved' : 'none') +
    ' · code errors: ' + (errs.length ? errs.join(', ') : 'none');
}
async function compactHistory(messages) {
  const keepUser = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
  const body = messages.slice(1).filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));
  const req = [{
    role: 'system',
    content: 'Compress this agent session into a handover note for a successor that must finish the same job. Keep, verbatim where it matters: the objective, the design decisions (palette, fonts, motion rules), scene/element ids that exist now, what failed and why, the open todo items. Max 200 words. No pleasantries.'
  }].concat(body);
  const acc = await streamChat(req, null, () => {}, ABORT.signal);
  addUsage(acc.usage);
  const summary = (acc.content || '').slice(0, 4000);
  return [
    messages[0],
    { role: 'user', content: '[compacted earlier session — your own handover note]\n' + summary },
    keepUser || { role: 'user', content: 'Continue the same job.' }
  ];
}

