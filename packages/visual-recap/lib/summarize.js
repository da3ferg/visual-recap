// visual-recap: turn one tool call into a compact, redacted timeline event.

const fs = require('fs');
const path = require('path');

const MAX = 240; // max chars kept for any free-text field

function clip(s, n = MAX) {
  if (s == null) return undefined;
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Strip things that look like secrets before they ever touch disk.
function redact(s) {
  if (!s) return s;
  return s
    .replace(/(sk|pk|rk|ghp|gho|github_pat|xox[abpr]|AKIA)[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|pwd|authorization|bearer)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/g, '$1[redacted]')
    .replace(/(:\/\/[^:\s/]+:)[^@\s]+@/g, '$1[redacted]@');
}

function lines(s) {
  if (!s) return 0;
  return String(s).split('\n').length;
}

function rel(p, cwd) {
  if (!p) return undefined;
  try {
    const r = path.relative(cwd, p);
    return r && !r.startsWith('..') ? r : p;
  } catch { return p; }
}

function summarizeTool(name, input = {}, response, cwd) {
  const e = { tool: name };
  const resp = response && typeof response === 'object' ? response : {};
  switch (name) {
    case 'Edit':
    case 'MultiEdit': {
      e.file = rel(input.file_path, cwd);
      const edits = name === 'MultiEdit' ? (input.edits || []) : [input];
      e.removed = edits.reduce((a, x) => a + lines(x.old_string), 0);
      e.added = edits.reduce((a, x) => a + lines(x.new_string), 0);
      // keep a tiny sample of the change so the recap can animate a real diff
      const first = edits[0] || {};
      e.sample = {
        old: clip(redact(first.old_string), 400),
        new: clip(redact(first.new_string), 400),
      };
      break;
    }
    case 'Write':
      e.file = rel(input.file_path, cwd);
      e.added = lines(input.content);
      e.created = true;
      break;
    case 'NotebookEdit':
      e.file = rel(input.notebook_path, cwd);
      break;
    case 'Read':
      e.file = rel(input.file_path, cwd);
      break;
    case 'Grep':
      e.pattern = clip(redact(input.pattern), 120);
      e.where = rel(input.path, cwd);
      break;
    case 'Glob':
      e.pattern = clip(input.pattern, 120);
      break;
    case 'Bash': {
      e.cmd = clip(redact(input.command), 200);
      e.desc = clip(input.description, 140);
      const out = resp.stdout || resp.output || '';
      const err = resp.stderr || '';
      if (resp.exit_code != null) e.exit = resp.exit_code;
      if (resp.interrupted) e.interrupted = true;
      // last few lines of output are usually the interesting ones (test summary, build result)
      const tail = String(out + (err ? '\n' + err : '')).trim().split('\n').slice(-6).map(l => clip(redact(l), 140));
      if (tail.length && tail[0]) e.tail = tail;
      break;
    }
    case 'WebFetch':
      e.url = clip(input.url, 160);
      break;
    case 'WebSearch':
      e.query = clip(input.query, 160);
      break;
    case 'Task':
    case 'Agent':
      e.desc = clip(input.description || input.prompt, 160);
      break;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate': {
      if (Array.isArray(input.todos)) {
        e.todos = input.todos.map(t => ({ s: t.status, t: clip(t.content, 100) })).slice(0, 12);
      } else {
        e.task = clip(input.subject || input.description, 120);
        e.status = input.status;
      }
      break;
    }
    default: {
      // MCP and anything else: keep the name and a short hint of the input
      const hint = Object.entries(input).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
      e.hint = clip(redact(hint), 140);
    }
  }
  return e;
}

module.exports = { clip, redact, rel, summarizeTool };
