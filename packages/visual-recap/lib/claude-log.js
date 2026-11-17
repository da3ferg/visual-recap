// visual-recap: read Claude Code's own session transcripts (~/.claude/projects/<project>/*.jsonl) into
// timeline events, so recaps need no hooks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clip, redact, summarizeTool } = require('./summarize');

const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Claude Code names a project's folder after its path with every non-alphanumeric character as "-"
const slug = dir => dir.replace(/[^A-Za-z0-9]/g, '-');

function promptText(content) {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
  if (cmd) {
    const args = (text.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || '';
    return `${cmd[1].trim()} ${args.trim()}`.trim();
  }
  const t = text.trim();
  return t && !t.startsWith('<') && !t.startsWith('[Image') && !t.startsWith('Caveat:') ? t : '';
}

function readClaude(root, fromDay) {
  const dir = path.join(home, 'projects', slug(root));
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f)); } catch { return []; }
  const since = new Date(fromDay).getTime();
  const events = [];
  for (const f of files) {
    if (fs.statSync(f).mtimeMs < since) continue;
    const calls = new Map();
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain || !o.message) continue;
      const sid = String(o.sessionId || '').slice(0, 8), ts = o.timestamp, cwd = o.cwd || root;
      const content = o.message.content;
      if (o.type === 'assistant') {
        for (const b of Array.isArray(content) ? content : []) {
          if (b.type === 'tool_use') calls.set(b.id, { name: b.name, input: b.input || {}, ts });
        }
        continue;
      }
      const results = Array.isArray(content) ? content.filter(b => b.type === 'tool_result') : [];
      if (!results.length) {
        if (o.isMeta) continue;
        const p = promptText(content);
        if (p) events.push({ ts, sid, ev: 'UserPromptSubmit', prompt: clip(redact(p), 400) });
        continue;
      }
      for (const r of results) {
        const c = calls.get(r.tool_use_id);
        if (!c) continue;
        const resp = o.toolUseResult && typeof o.toolUseResult === 'object' && !Array.isArray(o.toolUseResult) ? { ...o.toolUseResult } : {};
        if (c.name === 'Bash' && resp.exit_code == null) resp.exit_code = r.is_error ? 1 : 0;
        events.push({ ts: c.ts, sid, ev: 'PostToolUse', ...summarizeTool(c.name, c.input, resp, cwd) });
      }
    }
  }
  return events;
}

module.exports = { readClaude };
