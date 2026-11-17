// standup-recap: turn a built recap HTML into an MP4 (plays anywhere video does).
// usage: visual-recap export <recap.html> [out.mp4]
//
// Plays the recap in headless Chrome at 1600x900, records it, then lays the embedded voice clips
// over the video at the moment each scene started. Needs ffmpeg and Playwright
// (npm i -g playwright; uses your installed Chrome, or Playwright's Chromium if there is none).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const [input, outArg] = process.argv.slice(2);
if (!input) { console.error('usage: visual-recap export <recap.html> [out.mp4]'); process.exit(1); }
const html = path.resolve(input);
const out = path.resolve(outArg || html.replace(/\.html?$/i, '') + '.mp4');

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('ffmpeg is needed for MP4 export (macOS: brew install ffmpeg · Linux: apt install ffmpeg).');
  process.exit(1);
}
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch {}
  console.error('Playwright is needed for MP4 export: npm i -g playwright');
  process.exit(1);
}

// voice clips are embedded by build.js as DATA.audio = { "<scene>": "data:audio/...;base64,..." }
function clips() {
  const m = fs.readFileSync(html, 'utf8').match(/"audio":(\{"\d+":"data:audio[^}]*\})/);
  return m ? JSON.parse(m[1]) : {};
}

async function main() {
  const { chromium } = loadPlaywright();
  const audio = clips();
  const voiced = Object.keys(audio).length > 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'standup-mp4-'));
  const W = 1600, H = 900;

  const args = ['--autoplay-policy=no-user-gesture-required'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', args }); }
  catch { browser = await chromium.launch({ args }); }
  const cli = path.join(path.dirname(require.resolve('playwright', { paths: [execSync('npm root -g', { encoding: 'utf8' }).trim(), __dirname] })), 'cli.js');
  const newCtx = () => browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  let ctx = await newCtx(), page;
  try { page = await ctx.newPage(); }
  catch (e) {
    if (!/install ffmpeg/.test(e.message)) throw e;
    console.log('installing Playwright\'s video recorder (one time, ~1 MB)…');
    spawnSync(process.execPath, [cli, 'install', 'ffmpeg'], { stdio: 'inherit' });
    await ctx.close(); ctx = await newCtx(); page = await ctx.newPage();
  }
  const t0 = Date.now();                      // the recording starts with the page
  const starts = [];
  await page.exposeFunction('__scene', (i, t) => { starts[i] = (t - t0) / 1000; process.stdout.write(`\rrecording scene ${i + 1}`); });
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#ctl,#hint{display:none!important} body{cursor:none!important}';
      document.head.append(s);
      const track = document.getElementById('track');
      let last = -1;
      const report = () => {
        const i = [...track.children].findIndex(c => c.classList.contains('cur'));
        if (i >= 0 && i !== last) { last = i; window.__scene(i, Date.now()); }
      };
      new MutationObserver(report).observe(track, { subtree: true, attributes: true, attributeFilter: ['class'] });
      report();
    });
  });
  await page.goto(require('url').pathToFileURL(html).href + (voiced ? '?voice' : '?autoplay'));

  // wait for the last scene, then until its animation and voice have both finished
  const n = await page.evaluate(() => document.getElementById('track').children.length);
  await page.waitForFunction(k => document.getElementById('track').children[k].classList.contains('cur'), n - 1, { timeout: 0, polling: 200 });
  const lastDur = await page.evaluate(k => parseFloat(document.getElementById('track').children[k].style.getPropertyValue('--d')) || 6, n - 1);
  await page.waitForTimeout(lastDur * 1000);
  await page.waitForFunction(() => !document.body.classList.contains('speaking'), null, { timeout: 0, polling: 200 });
  await page.waitForTimeout(1500);
  const end = (Date.now() - t0) / 1000;
  const video = page.video();
  await ctx.close(); await browser.close();
  const webm = await video.path();
  console.log(`\rrecorded ${n} scenes (${(end - starts[0]).toFixed(0)}s)          `);

  // cut the blank page load off the front, lay each clip where its scene began
  const cut = Math.max(0, starts[0] - 0.1);
  const ff = ['-loglevel', 'error', '-y', '-ss', cut.toFixed(3), '-t', (end - cut).toFixed(3), '-i', webm];
  const filters = [], labels = [];
  Object.entries(audio).forEach(([i, uri], j) => {
    if (starts[i] == null) return;
    const f = path.join(tmp, `${i}.${uri.slice(11, uri.indexOf(';')).replace('mpeg', 'mp3')}`);
    fs.writeFileSync(f, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
    ff.push('-i', f);
    const ms = Math.round((starts[i] - cut) * 1000);
    filters.push(`[${labels.length + 1}:a]adelay=${ms}|${ms}[a${j}]`); labels.push(`[a${j}]`);
  });
  if (labels.length) {
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[a]`);
    ff.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  }
  ff.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out);
  if (spawnSync('ffmpeg', ff, { stdio: 'inherit' }).status !== 0) { console.error('ffmpeg failed'); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote ${out}  (${(fs.statSync(out).size / 1048576).toFixed(1)} MB${labels.length ? ', with voice' : ', silent'})`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
