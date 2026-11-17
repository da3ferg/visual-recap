// standup-recap: read Codex's own session files (~/.codex/sessions) into the same event shape the
// hook logger writes, so recaps work in Codex without any hooks installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clip, redact, summarizeTool } = require('./log-event');

const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

// one JS string literal ("…", '…' or `…`) starting at s[i]
function strLit(s, i) {
  const q = s[i];
  let j = i + 1, out = '';
  while (j < s.length && s[j] !== q) {
    if (s[j] === '\\' && j + 1 < s.length) { const c = s[++j]; out += c === 'n' ? '\n' : c === 't' ? '\t' : c; }
    else out += s[j];
    j++;
  }
  return out;
}

// pull file changes out of apply_patch text
function patchEvents(text, cwd) {
  const evs = [];
  let cur = null;
  for (const l of String(text).split('\n')) {
    const m = l.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (m) {
      cur = { kind: m[1], file: m[2].trim(), old: [], add: [] };
      evs.push(cur);
    } else if (cur && /^[-+]/.test(l) && !l.startsWith('***')) {
      (l[0] === '+' ? cur.add : cur.old).push(l.slice(1));
    }
  }
  return evs.map(c => c.kind === 'Add'
    ? summarizeTool('Write', { file_path: c.file, content: c.add.join('\n') }, null, cwd)
    : { ...summarizeTool('Edit', { file_path: c.file, old_string: c.old.join('\n'), new_string: c.add.join('\n') }, null, cwd),
        ...(c.old.length ? {} : { removed: 0 }), ...(c.add.length ? {} : { added: 0 }) });
}

// command results look like {"exit_code":0,"output":"…"} or "Exit code: 1\n…"
function results(output) {
  const texts = Array.isArray(output) ? output.map(o => o.text || '') : [String(output ?? '')];
  const res = [];
  for (const t of texts) {
    let j; try { j = JSON.parse(t); } catch {}
    if (j && typeof j === 'object') {
      const exit = j.exit_code ?? j.metadata?.exit_code;
      if (exit != null || j.output != null) res.push({ exit_code: exit, stdout: j.output ?? '' });
    } else {
      const m = t.match(/Exit code: (\d+)/);
      if (m) res.push({ exit_code: +m[1], stdout: t.replace(/^[\s\S]*?Output:\n/, '') });
    }
  }
  return res;
}

function toolEvents(name, input, output, cwd) {
  switch (name) {
    case 'shell': case 'exec_command': case 'local_shell': {
      const cmd = Array.isArray(input.command) ? input.command.slice(-1)[0] : (input.cmd || input.command);
      return [summarizeTool('Bash', { command: cmd }, results(output)[0], cwd)];
    }
    case 'apply_patch': return patchEvents(typeof input === 'string' ? input : input.input || input.patch, cwd);
    case 'update_plan': return [summarizeTool('TodoWrite', { todos: (input.plan || []).map(p => ({ content: p.step, status: p.status })) })];
    case 'web_search': case 'web__run': {
      const q = input.query || input.search_query?.[0]?.q;
      return [summarizeTool('WebSearch', { query: q })];
    }
    case 'wait': case 'write_stdin': return [];
    default: return [summarizeTool(name, typeof input === 'object' ? input : { input })];
  }
}

// a code-mode "exec" cell: JS that calls tools.<name>({...}); find the calls we understand
function execEvents(js, output, cwd) {
  const evs = [];
  const res = results(output);
  let r = 0;
  for (const m of js.matchAll(/tools\.(\w+)\(/g)) {
    const name = m[1], at = m.index + m[0].length;
    if (name === 'exec_command') {
      const c = js.slice(at, at + 4000).match(/\bcmd\s*:\s*(["'`])/);
      if (!c) continue;
      evs.push(summarizeTool('Bash', { command: strLit(js, at + c.index + c[0].length - 1) }, res[r++], cwd));
    } else if (name === 'apply_patch') {
      evs.push(...patchEvents(js, cwd));
    } else if (!['wait', 'write_stdin'].includes(name)) {
      evs.push(...toolEvents(name, {}, null, cwd));
    }
  }
  return evs;
}

// Codex keeps sessions under sessions/YYYY/MM/DD/ by local start date
function sessionFiles(fromDay) {
  const base = path.join(home, 'sessions');
  const out = [];
  const walk = (d, depth) => {
    let names; try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      if (depth < 3) { walk(p, depth + 1); continue; }
      if (n.endsWith('.jsonl') && path.relative(base, d).split(path.sep).join('-') >= fromDay) out.push(p);
    }
  };
  walk(base, 0);
  return out.sort();
}

function readCodex(root, fromDay) {
  const events = [];
  for (const f of sessionFiles(fromDay)) {
    let sid = '', cwd = '', keep = false;
    const calls = new Map();
    const pending = [];
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      const p = o.payload || {}, ts = o.timestamp;
      if (o.type === 'session_meta') {
        sid = String(p.id || p.session_id || '').slice(0, 8);
        cwd = p.cwd || '';
        keep = cwd === root || cwd.startsWith(root + path.sep);
        if (!keep) break;
        continue;
      }
      if (o.type !== 'response_item' && o.type !== 'event_msg') continue;
      if (p.type === 'message' && p.role === 'user') {
        const text = (p.content || []).map(c => c.text || '').join('\n').trim();
        if (text && !text.startsWith('<') && !text.startsWith('# AGENTS.md')) pending.push({ ts, sid, ev: 'UserPromptSubmit', prompt: clip(redact(text), 400) });
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
        let input = p.input ?? p.arguments ?? p.action ?? {};
        if (typeof input === 'string' && p.type === 'function_call') { try { input = JSON.parse(input); } catch {} }
        calls.set(p.call_id, { name: p.name || 'local_shell', input, ts });
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const c = calls.get(p.call_id);
        if (!c) continue;
        const evs = c.name === 'exec' && typeof c.input === 'string'
          ? execEvents(c.input, p.output, cwd)
          : toolEvents(c.name, c.input, p.output, cwd);
        for (const e of evs) pending.push({ ts: c.ts, sid, ev: 'PostToolUse', ...e });
      } else if (p.type === 'task_complete') {
        pending.push({ ts, sid, ev: 'Stop' });
      }
    }
    if (keep) events.push(...pending);
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

module.exports = { readCodex };
