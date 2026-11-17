// standup-recap: embed a recap.json into the animated player and write a single self-contained HTML file.
//
// usage: visual-recap build <recap.json> [out.html] [--tts kokoro|openai|elevenlabs] [--voice <name or id>] [--audio-dir <dir>]
//
//   (no flags)           silent recap: no narration, no voice controls
//   --tts kokoro         free open-source Kokoro voice, generated locally (Python; ~120 MB model downloaded once)
//   --tts openai         pre-generate narration with OpenAI (needs OPENAI_API_KEY)
//   --tts elevenlabs     pre-generate narration with ElevenLabs (needs ELEVENLABS_API_KEY)
//   --voice X            voice for the chosen provider (kokoro: af_heart, am_michael, bf_emma…; openai: coral, alloy, ash, sage, verse…; elevenlabs: a voice id)
//   --audio-dir D        use your own recordings: D/0.mp3 is the intro, D/1.mp3 step 1 … D/<n+1>.mp3 the wrap-up
//   --print-script       print exactly what will be spoken, per scene, and exit
//
// default out: <project>/.standup/recaps/<date>-<slug>.html

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const bool = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const tts = flag('--tts');
const voiceArg = flag('--voice');
const audioDir = flag('--audio-dir');
const printScript = bool('--print-script');
const [input, outArg] = argv;
if (!input) { console.error('usage: visual-recap build <recap.json> [out.html] [--tts kokoro|openai|elevenlabs] [--voice X] [--audio-dir D]'); process.exit(1); }
if (tts && !['kokoro', 'openai', 'elevenlabs'].includes(tts)) { console.error('--tts must be kokoro, openai or elevenlabs'); process.exit(1); }

const recap = JSON.parse(fs.readFileSync(input, 'utf8'));

// light validation so a bad recap fails loudly here, not silently in the browser
const KINDS = ['plan', 'explore', 'edit', 'run', 'test', 'fix', 'decide', 'ship'];
const problems = [];
if (!recap.title) problems.push('missing "title"');
if (!recap.summary) problems.push('missing "summary"');
if (!Array.isArray(recap.steps) || !recap.steps.length) problems.push('"steps" must be a non-empty array');
(recap.steps || []).forEach((s, i) => {
  if (!KINDS.includes(s.kind)) problems.push(`step ${i + 1}: kind "${s.kind}" must be one of ${KINDS.join(', ')}`);
  if (!s.title) problems.push(`step ${i + 1}: missing title`);
  if (!s.narration) problems.push(`step ${i + 1}: missing narration`);
  if (s.diff && !Array.isArray(s.diff.lines)) problems.push(`step ${i + 1}: diff.lines must be an array`);
});
if ((recap.steps || []).length > 9) problems.push(`${recap.steps.length} steps is too many for a standup; merge down to 4–7`);
if (problems.length) { console.error('recap.json problems:\n  - ' + problems.join('\n  - ')); process.exit(2); }

// ---- what gets spoken for each scene (kept identical to script() in player.html) ----
const plain = t => String(t ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const end = t => /[.!?]$/.test(t) ? t : t + '.';
function scripts() {
  const vo = recap.voiceover || {};
  const out = [vo.intro || `${end(plain(recap.title))} ${plain(recap.summary)}`];
  for (const s of recap.steps) out.push(s.voiceover || `${end(plain(s.title))} ${plain(s.narration)}`);
  if (vo.outro) out.push(vo.outro);
  else {
    const parts = [];
    if ((recap.blockers || []).length) parts.push('Blockers: ' + end(recap.blockers.map(plain).join('. ')));
    if ((recap.next || []).length) parts.push('Next up: ' + end(recap.next.map(plain).join(', and ')));
    parts.push(plain(recap.closing || 'That’s the update.'));
    out.push(parts.join(' '));
  }
  return out;
}

async function speakOpenAI(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: voiceArg || 'coral',
      input: text,
      instructions: 'You are a developer giving a quick standup update to teammates. Warm, clear, upbeat, natural conversational pace. Not salesy.',
      response_format: 'mp3',
    }),
  });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function speakElevenLabs(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const voice = voiceArg || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}


// ---- Kokoro: free open-source voice, runs locally (Apache-2.0) ----
const os = require('os');
const { spawnSync } = require('child_process');
function pythonWithKokoro() {
  const home = os.homedir();
  const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const candidates = [
    process.env.STANDUP_PYTHON,
    path.join(home, '.standup', 'kokoro-venv', ...bin),
    path.join(home, '.hyperframes-kokoro', ...bin),   // reuse an existing kokoro-onnx install if there is one
  ].filter(Boolean);
  const ok = py => (!/[\\/]/.test(py) || fs.existsSync(py)) && spawnSync(py, ['-c', 'import kokoro_onnx, soundfile'], { stdio: 'ignore' }).status === 0;
  const found = candidates.find(ok);
  if (found) return found;
  // first run: create a private venv just for the voice
  // kokoro-onnx supports Python 3.10 to 3.13, so prefer those over a newer default python3
  const sys = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'].find(c => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
  if (!sys) throw new Error('Python 3.10 to 3.13 is needed for the Kokoro voice.');
  const venv = path.join(home, '.standup', 'kokoro-venv');
  console.log(`setting up the Kokoro voice in ${venv} (one time)…`);
  fs.mkdirSync(path.dirname(venv), { recursive: true });
  if (spawnSync(sys, ['-m', 'venv', venv], { stdio: 'inherit' }).status !== 0) throw new Error('could not create a Python venv');
  const py = path.join(venv, ...bin);
  if (spawnSync(py, ['-m', 'pip', 'install', '-q', 'kokoro-onnx', 'soundfile'], { stdio: 'inherit' }).status !== 0) throw new Error('pip install kokoro-onnx failed');
  return py;
}
function voiceKokoro(lines) {
  const py = pythonWithKokoro();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'standup-voice-'));
  fs.writeFileSync(path.join(tmp, 'scripts.json'), JSON.stringify(lines));
  const args = [path.join(__dirname, 'kokoro_tts.py'), path.join(tmp, 'scripts.json'), tmp];
  if (voiceArg) args.push('--voice', voiceArg);
  const r = spawnSync(py, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error('Kokoro voice generation failed (see above)');
  return tmp;
}

const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'audio/webm' };

async function main() {
  const lines = scripts();
  if (printScript) { lines.forEach((t, i) => console.log(`[${i}] ${t}\n`)); return; }

  const audio = {};
  let clipDir = audioDir;
  if (!clipDir && tts === 'kokoro') {
    try { clipDir = voiceKokoro(lines); }
    catch (e) { console.error(`${e.message}\n  → building a silent recap instead.`); }
  }
  if (clipDir) {
    for (let i = 0; i < lines.length; i++) {
      const f = Object.keys(MIME).map(ext => path.join(clipDir, i + ext)).find(fs.existsSync);
      if (f) audio[i] = `data:${MIME[path.extname(f)]};base64,` + fs.readFileSync(f).toString('base64');
    }
    console.log(`audio: ${Object.keys(audio).length}/${lines.length} clips${audioDir ? ' from ' + audioDir : ' (Kokoro)'}`);
  } else if (tts === 'openai' || tts === 'elevenlabs') {
    const fn = { openai: speakOpenAI, elevenlabs: speakElevenLabs }[tts];
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`voicing scene ${i + 1}/${lines.length}… `);
      try { audio[i] = 'data:audio/mpeg;base64,' + (await fn(lines[i])).toString('base64'); console.log('ok'); }
      catch (e) { console.log('failed'); console.error(`  ${e.message}\n  → building a silent recap instead.`); for (const k in audio) delete audio[k]; break; }
    }
  }
  if (Object.keys(audio).length) recap.audio = audio; else delete recap.audio;

  const tpl = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf8');
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const json = JSON.stringify(recap).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
  const html = tpl.replace('/*__RECAP__*/null', () => json);

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const slug = String(recap.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'recap';
  const date = new Date().toLocaleDateString('en-CA');
  const out = outArg || path.join(root, '.standup', 'recaps', `${date}-${slug}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  // keep .standup out of git without touching the user's .gitignore
  const gi = path.join(root, '.standup', '.gitignore');
  if (fs.existsSync(path.dirname(gi)) && !fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');

  console.log(`wrote ${out}  (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`${lines.length} scenes (intro + ${recap.steps.length} steps + wrap-up) · narration: ${recap.audio ? 'embedded audio' : 'none (silent)'}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
