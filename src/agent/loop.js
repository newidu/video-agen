/* Agent execution loop and multi-step tool orchestration. Extracted from original/source.html lines 4190-4373. */
/* ---------- the agent loop ---------- */
/* no step limit: the loop runs until the model stops calling tools (Stop button always works).
   SAFE_CAP only exists so a broken stream can never spin forever — it is far above any real run. */
const SAFE_CAP = 999;
/* a question about the footage is not a request to build */
function wantsVideo(text) {
  return !/[?]|\b(how many|how long|what|why|which|who|explain|tell me|read|count)\b/i.test(String(text || ''));
}

/* run every tool call of one assistant turn, streaming its result into the chat */
async function execToolCalls(acc, cur, messages) {
  messages.push({ role: 'assistant', content: acc.content || null, tool_calls: acc.toolCalls });
  for (const tc of acc.toolCalls) {
    const name = tc.function && tc.function.name;
    const rawArgs = (tc.function && tc.function.arguments) || '{}';
    const resRow = addToolRow(cur.step, name || '?', rawArgs);
    let out;
    try {
      const args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      if (!TOOL_IMPL[name]) out = 'unknown tool: ' + name;
      else {
        const r = await TOOL_IMPL[name](args);
        if (r && typeof r === 'object' && (r.text || r.thumb)) {
          out = r.text;
          if (r.thumb) {
            const img = document.createElement('img');
            img.className = 'thumb';
            img.src = r.thumb;
            cur.step.appendChild(img);
          }
        } else out = (typeof r === 'string') ? r : JSON.stringify(r);
      }
    } catch (e) { out = 'tool error: ' + (e.message || e); }
    out = String(out === undefined ? '' : out);
    if (name !== 'read_skill') out = compactResult(name, rawArgs, out);
    if (out.length > TOOL_CAP) out = out.slice(0, TOOL_CAP) + ' …[truncated ' + (out.length - TOOL_CAP) + ' chars — ask for less or read again]';
    resRow.style.display = '';
    resRow.textContent = '→ ' + (out.length > 1400 ? out.slice(0, 1400) + ' …' : out);
    messages.push({ role: 'tool', tool_call_id: tc.id || ('call_' + name), content: out.slice(0, 12000) });
    $('chat').scrollTop = $('chat').scrollHeight;
  }
}

async function runAgent(userText) {
  const bubble = beginBotBubble();
  const tools = $('useTools').checked ? toolSchema() : null;
  const messages = [{ role: 'system', content: systemPrompt() }]
    .concat(CHAT.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10).map(m => ({ role: m.role, content: m.content })));
  messages.push({ role: 'user', content: userText });

  let cur = beginStep(bubble);
  const render = acc => {
    if (acc.reasoning) {
      cur.think.style.display = '';
      cur.thinkBody.textContent = acc.reasoning;
      cur.think.scrollTop = cur.think.scrollHeight;
    }
    if (acc.content) cur.body.textContent = acc.content;
    $('chat').scrollTop = $('chat').scrollHeight;
  };

  ABORT = new AbortController();
  let finalText = '';
  let built = SPEC.scenes.length > 0;
  let lastPromptTokens = 0;
  try {
    let lastSig = '', repeat = 0;
    for (let step = 0; step < SAFE_CAP; step++) {
      if (step) cur = beginStep(bubble);
      window.STEP_NOTE = '';
      $('stepInfo').textContent = 'step ' + (step + 1) + (tools ? '' : ' · tools off');
      const reminder = [stateLine(), todoReminder()].filter(Boolean).join('\n');
      const wire = reminder ? messages.concat([{ role: 'system', content: reminder }]) : messages;
      /* thinking is the expensive part of a step: let the model plan once, then
         run the mechanical tool steps without it */
      window.THINK_OVERRIDE = $('thinking').value === 'auto' ? (step === 0 ? 'on' : 'off') : null;
      /* step 0 plans on the picked model; routine tool steps are routed down */
      window.MODEL_OVERRIDE = step === 0 ? null : cheapModel($('model').value);
      const acc = await streamChat(wire, tools, render, ABORT.signal);
      if (window.STEP_NOTE) { $('stepInfo').textContent = 'step ' + (step + 1) + ' · ' + window.STEP_NOTE; }
      lastPromptTokens = (acc.usage && (acc.usage.prompt_tokens || 0)) || lastPromptTokens;
      addUsage(acc.usage);
      bubble.usage.textContent = usageLine(acc.usage) + (step ? ' · after ' + (step + 1) + ' steps' : '');

      if (acc.toolCalls && acc.toolCalls.length) {
        const sig = acc.toolCalls.map(tc => (tc.function && tc.function.name) + '(' + ((tc.function && tc.function.arguments) || '') + ')').join('|');
        repeat = sig === lastSig ? repeat + 1 : 0;
        lastSig = sig;
        await execToolCalls(acc, cur, messages);
        pruneTools(messages);
        built = SPEC.scenes.length > 0;
        if (lastPromptTokens > COMPACT_AT && messages.length > 10) {
          const before = messages.length;
          messages = await compactHistory(messages);
          lastPromptTokens = 0;
          addNote(cur.step, 'context compacted: ' + before + ' messages → ' + messages.length + ' (old tool results cleared, session summarised)');
        }
        if (repeat >= 3) {
          cur.body.textContent = 'Stopped the loop: the model repeated the same call 4 times in a row.';
          break;
        }
        continue;
      }

      finalText = acc.content || '';
      const asJson = tryJson(finalText);
      if (asJson && (asJson.spec || asJson.ops || asJson.action)) {
        if (asJson.say) cur.body.textContent = asJson.say;
        applyAgentResult(asJson);
        finalText = asJson.say || '(updated the video)';
        built = SPEC.scenes.length > 0;
        break;
      }

      /* the model described a video instead of building one — force the build, then keep looping */
      if (tools && !built && wantsVideo(userText)) {
        cur = beginStep(bubble);
        cur.body.textContent = 'Nothing is on the stage yet — forcing the build.';
        messages.push({
          role: 'user',
          content: 'The stage is STILL EMPTY: no scenes exist. Stop explaining and call replace_spec right now with the complete spec for the video I asked for.'
        });
        $('stepInfo').textContent = 'forcing the build · step ' + (step + 1);
        const forced = await streamChat(messages, tools, render, ABORT.signal,
          { type: 'function', function: { name: 'replace_spec' } });
        addUsage(forced.usage);
        if (forced.toolCalls && forced.toolCalls.length) {
          await execToolCalls(forced, cur, messages);
          built = SPEC.scenes.length > 0;
          cur.body.textContent = built
            ? 'Built ' + SPEC.scenes.length + ' scene' + (SPEC.scenes.length === 1 ? '' : 's') + ' · ' + DUR.toFixed(1) + 's.'
            : 'Still nothing was built — see the tool result above.';
        } else {
          cur.body.textContent = 'The model refused to build (no tool call came back).';
        }
        if (built) finalText = '';
        continue;
      }
      break;
    }

    const say = built
      ? (finalText || 'Built ' + SPEC.scenes.length + ' scene' + (SPEC.scenes.length === 1 ? '' : 's') + ' · ' + DUR.toFixed(1) + 's · ' + Math.round(DUR * 30) + ' frames.')
      : (finalText || '(no answer)');
    CHAT.push({ role: 'assistant', content: say });
    agentStatus(built ? 'Video built.' : 'Done.');
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
      cur.body.textContent = 'Stopped. (nothing was sent back to the model)';
      agentStatus('Stopped.');
      ABORT = null;
      BUSY = false; $('btnSend').disabled = false; $('btnStop').disabled = true;
      $('stepInfo').textContent = '';
      return;
    }
    cur.body.textContent = 'Request failed — ' + (e.message || e) +
      '\nIf it says "Failed to fetch", check the key, the base URL and any ad-blocker.';
    cur.body.classList.add('errline');
    agentStatus('Request failed.');
  } finally {
    ABORT = null;
    BUSY = false; $('btnSend').disabled = false; $('btnStop').disabled = true;
    $('stepInfo').textContent = '';
    $('chat').scrollTop = $('chat').scrollHeight;
  }
}

async function sendPrompt() {
  if (BUSY) return;
  const text = $('prompt').value.trim();
  if (!text) { agentStatus('Type what you want first.'); return; }
  if (!apiKey()) { agentStatus('Paste your DeepSeek API key (sk-…) above and press Save.'); return; }
  pushMsg('user', text);
  $('prompt').value = '';
  BUSY = true; $('btnSend').disabled = true; $('btnStop').disabled = false;
  agentStatus('Working…');
  await runAgent(text);
}
$('btnSend').onclick = sendPrompt;
$('btnStop').onclick = () => { if (ABORT) ABORT.abort(); agentStatus('Stopped.'); };
$('prompt').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendPrompt(); }
});

