// node test/codex-log.test.js  — reads a fake Codex session and checks the events it yields
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
process.env.CODEX_HOME = home;
const d = path.join(home, 'sessions', '2026', '11', '16');
fs.mkdirSync(d, { recursive: true });
const root = '/work/app';
const L = (type, payload, ts = '2026-11-16T15:00:00Z') => JSON.stringify({ timestamp: ts, type, payload });
const patch = '*** Begin Patch\n*** Update File: src/a.js\n@@\n-old line\n+new line\n+second\n*** Add File: src/b.js\n+hello\n*** End Patch';
fs.writeFileSync(path.join(d, 'rollout-1.jsonl'), [
  L('session_meta', { id: 'abcdef1234', cwd: root }),
  L('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] }),
  L('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the bug token=supersecretvalue' }] }),
  L('response_item', { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) }),
  L('response_item', { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'ok 3 passed', metadata: { exit_code: 0 } }) }),
  L('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: patch }),
  L('response_item', { type: 'custom_tool_call_output', call_id: 'c2', output: 'Success' }),
  L('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c3', input: 'text(await tools.exec_command({cmd:"git status --short"}))' }),
  L('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c4', input: 'text(await tools.apply_patch(' + JSON.stringify('*** Begin Patch\n*** Update File: /work/app/src/c.js\n@@\n-a\n+b\n*** End Patch') + '))' }),
  L('response_item', { type: 'custom_tool_call_output', call_id: 'c4', output: 'Done' }),
  L('response_item', { type: 'custom_tool_call_output', call_id: 'c3', output: [{ type: 'input_text', text: 'Script completed' }, { type: 'input_text', text: '{"exit_code":1,"output":"fatal: nope"}' }] }),
  L('event_msg', { type: 'task_complete' }),
].join('\n'));
fs.writeFileSync(path.join(d, 'rollout-2.jsonl'), L('session_meta', { id: 'other', cwd: '/elsewhere' }) + '\n');

const ev = require('../scripts/codex-log').readCodex(root, '2026-11-15');
const kinds = ev.map(e => e.ev === 'PostToolUse' ? e.tool : e.ev);
assert.deepStrictEqual(kinds, ['UserPromptSubmit', 'Bash', 'Edit', 'Write', 'Edit', 'Bash', 'Stop']);
assert.match(ev[0].prompt, /\[redacted\]/);
assert.strictEqual(ev[1].cmd, 'npm test'); assert.strictEqual(ev[1].exit, 0);
assert.deepStrictEqual([ev[2].file, ev[2].added, ev[2].removed], ['src/a.js', 2, 1]);
assert.strictEqual(ev[3].file, 'src/b.js');
assert.strictEqual(ev[5].cmd, 'git status --short'); assert.strictEqual(ev[5].exit, 1);
assert.deepStrictEqual([ev[4].file, ev[4].added, ev[4].removed], ['src/c.js', 1, 1]);
assert.ok(ev.every(e => e.sid === 'abcdef12'));
fs.rmSync(home, { recursive: true, force: true });
console.log('codex-log ok');
