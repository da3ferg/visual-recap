// visual-recap: turn Claude Code and Codex session history into a compact timeline the agent can read in one go.
//
// usage: visual-recap gather [--day YYYY-MM-DD | --since YYYY-MM-DD] [--session <8-char id>] [--project <dir>] [--source claude|codex|all]
// prints a plain-text timeline grouped by turn (one turn = one user prompt), plus git stats.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(opt('--project', process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const today = new Date().toLocaleDateString('en-CA');
const day = opt('--day');
const since = opt('--since');
const sid = opt('--session');

const source = opt('--source', 'all'); // claude | codex | all
const localDay = iso => new Date(iso).toLocaleDateString('en-CA');
const inRange = d => (day ? d === day : since ? d >= since : d === today);
// the day before covers sessions that started before midnight
const from = new Date(new Date(day || since || today).getTime() - 864e5).toLocaleDateString('en-CA');

let events = [];
if (source !== 'codex') events.push(...require('./claude-log').readClaude(root, from).map(e => ({ ...e, src: 'Claude Code' })));
if (source !== 'claude') events.push(...require('./codex-log').readCodex(root, from).map(e => ({ ...e, src: 'Codex' })));
events = events.filter(e => e.ts && inRange(localDay(e.ts)));
// keep each session together (sessions can overlap), sessions in the order they started
const first = {};
for (const e of events) if (!first[e.sid] || e.ts < first[e.sid]) first[e.sid] = e.ts;
const key = e => `${first[e.sid]}|${e.sid}|${e.ts}`;
events.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
if (sid) events = events.filter(e => e.sid === sid);
if (!events.length) {
  console.log(`No Claude Code or Codex sessions for ${root} in that range.`);
  process.exit(0);
}
const days = [...new Set(events.map(e => localDay(e.ts)))];
const sources = [...new Set(events.map(e => e.src))];

// group into turns
const turns = [];
let cur = null;
for (const e of events) {
  if (e.ev === 'UserPromptSubmit' || !cur) {
    cur = { start: e.ts, sid: e.sid, prompt: e.prompt || '(continued)', tools: [] };
    turns.push(cur);
    if (e.ev === 'UserPromptSubmit') continue;
  }
  if (e.ev === 'Stop') { cur.end = e.ts; continue; }
  cur.tools.push(e);
}

const t = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const filesTouched = new Map();
let cmds = 0, failed = 0;

function line(e) {
  switch (e.tool) {
    case 'Read': return `read    ${e.file}`;
    case 'Grep': return `search  "${e.pattern}"${e.where ? ' in ' + e.where : ''}`;
    case 'Glob': return `find    ${e.pattern}`;
    case 'Edit': case 'MultiEdit': {
      const f = filesTouched.get(e.file) || { a: 0, r: 0 }; f.a += e.added || 0; f.r += e.removed || 0; filesTouched.set(e.file, f);
      let s = `edit    ${e.file}  (+${e.added}/-${e.removed})`;
      if (e.sample && e.sample.new) s += `\n          - ${e.sample.old || ''}\n          + ${e.sample.new}`;
      return s;
    }
    case 'Write': {
      const f = filesTouched.get(e.file) || { a: 0, r: 0, created: true }; f.a += e.added || 0; filesTouched.set(e.file, f);
      return `create  ${e.file}  (${e.added} lines)`;
    }
    case 'Bash': {
      cmds++; if (e.exit && e.exit !== 0) failed++;
      let s = `run     ${e.desc ? e.desc + '  →  ' : ''}${e.cmd}${e.exit != null ? `  [exit ${e.exit}]` : ''}`;
      if (e.tail) s += '\n' + e.tail.map(l => '          | ' + l).join('\n');
      return s;
    }
    case 'WebSearch': return `web     search "${e.query}"`;
    case 'WebFetch': return `web     fetch ${e.url}`;
    case 'Task': case 'Agent': return `agent   ${e.desc}`;
    case 'TodoWrite': return `plan    ` + (e.todos || []).map(x => `[${x.s === 'completed' ? 'x' : x.s === 'in_progress' ? '~' : ' '}] ${x.t}`).join('  ');
    case 'TaskCreate': case 'TaskUpdate': return `plan    ${e.task || ''}${e.status ? ' → ' + e.status : ''}`;
    default: return `tool    ${e.tool}${e.hint ? '  ' + e.hint : ''}`;
  }
}

const out = [];
out.push(`# Standup log: ${days.join(', ')} from ${sources.join(' and ')}  (${root})`);
turns.forEach((tr, i) => {
  out.push('');
  out.push(`## Turn ${i + 1}  ${t(tr.start)}${tr.end ? '–' + t(tr.end) : ''}  [session ${tr.sid}]`);
  out.push(`ask: ${tr.prompt}`);
  // collapse runs of consecutive reads into one line so the timeline stays short
  let reads = [];
  const flush = () => { if (reads.length) { out.push(`  read    ${reads.length > 4 ? reads.slice(0, 4).join(', ') + ` +${reads.length - 4} more` : reads.join(', ')}`); reads = []; } };
  for (const e of tr.tools) {
    if (e.tool === 'Read') { reads.push(e.file); continue; }
    flush();
    out.push('  ' + line(e));
  }
  flush();
});

out.push('');
out.push('## Totals');
let A = 0, R = 0;
for (const [f, v] of filesTouched) { A += v.a; R += v.r; }
out.push(`files changed: ${filesTouched.size}   lines +${A}/-${R}   commands: ${cmds}   failed commands: ${failed}`);
for (const [f, v] of filesTouched) out.push(`  ${v.created ? 'new ' : '    '}${f}  +${v.a}/-${v.r}`);

try {
  const stat = execSync('git diff --shortstat HEAD 2>/dev/null; git log --since=midnight --oneline 2>/dev/null | head -15', { cwd: root, encoding: 'utf8' }).trim();
  const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: root, encoding: 'utf8' }).trim();
  if (branch) { out.push(''); out.push(`## Git (branch ${branch})`); if (stat) out.push(stat); }
} catch {}

console.log(out.join('\n'));
