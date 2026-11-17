#!/usr/bin/env node
// visual-recap <command> [args]: gather | build | export | example
const path = require('path');
const fs = require('fs');
const [cmd, ...rest] = process.argv.slice(2);
const lib = path.join(__dirname, '..', 'lib');
const cmds = { gather: 'gather.js', build: 'build.js', export: 'export.js' };
if (cmd === 'example') {
  // copy the sample recap.json somewhere editable, or print it
  const src = path.join(lib, 'example-recap.json');
  if (rest[0]) { fs.copyFileSync(src, rest[0]); console.log(`wrote ${rest[0]}`); } else process.stdout.write(fs.readFileSync(src, 'utf8'));
} else if (cmds[cmd]) {
  process.argv = [process.argv[0], path.join(lib, cmds[cmd]), ...rest];
  require(path.join(lib, cmds[cmd]));
} else {
  console.log(`visual-recap: animated standup recaps of what your coding agent did

  visual-recap gather [--day YYYY-MM-DD | --since YYYY-MM-DD] [--source claude|codex|all]
      timeline of this project's Claude Code and Codex sessions
  visual-recap build <recap.json> [out.html] [--tts kokoro|openai|elevenlabs] [--voice X] [--print-script]
      recap.json -> one self-contained animated HTML player
  visual-recap export <recap.html> [out.mp4]
      HTML recap -> MP4 with the voice (needs ffmpeg and Playwright)
  visual-recap example [file]
      a full sample recap.json`);
  process.exit(cmd ? 1 : 0);
}
