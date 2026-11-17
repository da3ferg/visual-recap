// node test/claude-log.test.js  — reads a fake Claude Code transcript and checks the events it yields
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
process.env.CLAUDE_CONFIG_DIR = home;
const root = '/work/my.app';
const d = path.join(home, 'projects', '-work-my-app');
fs.mkdirSync(d, { recursive: true });
const ts = '2026-11-16T15:00:00Z';
const L = o => JSON.stringify({ sessionId: 'abcdef1234', cwd: root, timestamp: ts, ...o });
fs.writeFileSync(path.join(d, 's1.jsonl'), [
  L({ type: 'user', message: { content: 'fix the bug password=hunter2' } }),
  L({ type: 'user', isMeta: true, message: { content: 'Caveat: ignore' } }),
  L({ type: 'user', message: { content: '<command-name>/standup</command-name><command-args>with voice</command-args>' } }),
  L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/work/my.app/src/a.js', old_string: 'a', new_string: 'b\nc' } }] } }),
  L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, toolUseResult: { filePath: '/work/my.app/src/a.js' } }),
  L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } }),
  L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'fail' }] }, toolUseResult: { stdout: '1 failed', stderr: '' } }),
  L({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'x' } }] } }),
].join('\n'));
const ev = require('../lib/claude-log').readClaude(root, '2026-11-15');
assert.deepStrictEqual(ev.map(e => e.ev === 'PostToolUse' ? e.tool : e.ev), ['UserPromptSubmit', 'UserPromptSubmit', 'Edit', 'Bash']);
assert.match(ev[0].prompt, /\[redacted\]/);
assert.strictEqual(ev[1].prompt, '/standup with voice');
assert.deepStrictEqual([ev[2].file, ev[2].added, ev[2].removed], ['src/a.js', 2, 1]);
assert.strictEqual(ev[3].exit, 1);
fs.rmSync(home, { recursive: true, force: true });
console.log('claude-log ok');
