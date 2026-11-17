---
name: standup-recap
description: Turn the work Claude Code just did into an animated, presentable standup recap — a self-contained HTML player that walks through each step (plan, explore, edit, run, test, fix, decision, ship) with motion, real diffs and terminal output. Use whenever the user asks for a standup update, a recap, "what did we do today", "show the team what changed", "walk me through what you did", a demo of the session, or runs /standup — even if they don't say "animation" or "recap".
---

# Standup recap

The plugin's hooks have been quietly recording every prompt and tool call into
`.standup/log/<date>.jsonl` in the project. Your job is to turn that raw log into a
**short story a teammate can follow in under two minutes**, then build it into the
animated player.

Think like a developer presenting at standup, not like a log viewer: the audience
wants to know *what changed, why, and whether it works* — not every file you read.

## 1. Gather

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gather.js"                 # today (default)
node "${CLAUDE_PLUGIN_ROOT}/scripts/gather.js" --since 2026-11-14
node "${CLAUDE_PLUGIN_ROOT}/scripts/gather.js" --session a1b2c3d4
```

If `CLAUDE_PLUGIN_ROOT` isn't set in your shell, the scripts live next to this skill
at `../../scripts/`.

Pick the scope from what the user asked ("this session" → the current session id
from the most recent turn; "today" → default; "since Friday" → `--since`). If the
log is empty, say so plainly and offer to build the recap from `git log`/`git diff`
plus this conversation instead — don't invent steps.

Also look at the actual changes when you need detail for a diff: `git diff`,
`git diff --stat`, or read the edited file around the change.

## 2. Find the story

Collapse the timeline into **4–7 steps**. Each step is one *beat* of the work, not one
tool call. Typical shape:

1. **plan** — what was asked and the approach chosen
2. **explore** — where the relevant code lives (only if it was non-obvious)
3. **edit** — the core change (one step per meaningful change, max 2–3)
4. **run / test** — proving it works
5. **fix** — if something broke and got fixed, this is the most interesting beat; keep it
6. **decide** — a real fork in the road where an option was chosen
7. **ship** — committed / PR opened / deployed

Merge aggressively. 30 Reads + 4 Greps = one explore step. Three edits to the same
function = one edit step. Drop dead ends unless they taught something.

## 3. Write it for humans

- **title**: what happened, in ≤7 words, active voice. "Moved auth checks into middleware", not "Edit middleware.ts".
- **narration**: 1–2 sentences, ≤40 words, spoken-style. Say *why*, not just what.
  Wrap the 1–3 most important words in `*asterisks*` — they render highlighted.
- Use the team's language: name features and outcomes, not tool names. Never say "I used the Edit tool".
- Numbers beat adjectives: "cut cold start from 2.1s to 600ms" > "made it faster".
- Be honest. Failed tests, skipped work and open questions go in the recap (as a `fix`
  step, `checks` with `ok:false`, or `blockers`). A recap that hides problems is worse than none.

## 4. Write recap.json

Write it to `.standup/recaps/recap.json` (the folder is gitignored). Schema:

```json
{
  "title": "Faster file previews",
  "summary": "Previews for large PDFs now *stream* instead of waiting for the full download — first page shows in under a second.",
  "date": "Mon Nov 16",
  "author": "Sam + agent",
  "repo": "acme-docs",
  "branch": "feat/stream-previews",
  "stats": { "files": 6, "added": 214, "removed": 58, "commands": 11, "tests": "48 / 48" },
  "steps": [
    { "kind": "plan", "title": "...", "narration": "...", "bullets": ["...", "..."] },
    { "kind": "explore", "title": "...", "narration": "...", "root": "src",
      "tree": [ {"p":"src/"}, {"p":"src/preview/"}, {"p":"src/preview/pdf.ts","hit":true}, {"p":"src/preview/image.ts"} ] },
    { "kind": "edit", "title": "...", "narration": "...", "files": ["src/preview/pdf.ts"],
      "diff": { "file": "src/preview/pdf.ts", "start": 42, "added": 31, "removed": 9,
                "lines": [ {"t":" ","s":"export async function render(doc) {"},
                           {"t":"-","s":"  const buf = await fetchAll(doc.url)"},
                           {"t":"+","s":"  const stream = openRange(doc.url, 0, CHUNK)"} ] } },
    { "kind": "test", "title": "...", "narration": "...",
      "terminal": { "cmd": "pnpm test preview", "output": ["✓ pdf streams first page", "48 passed"] },
      "checks": [ {"label":"Unit tests","ok":true}, {"label":"Manual check on a 90MB PDF","ok":true} ] },
    { "kind": "decide", "title": "...", "narration": "...",
      "options": [ {"label":"Range requests","why":"works with existing S3 setup","chosen":true}, {"label":"Pre-render thumbnails","why":"needs a worker"} ] },
    { "kind": "ship", "title": "...", "narration": "...", "bullets": ["PR #142 opened", "Preview env deployed"] }
  ],
  "done": ["Streaming PDF previews"],
  "next": ["Same treatment for video", "Add a progress bar"],
  "blockers": [],
  "closing": "That’s the update."
}
```

Which visual each step gets:

| kind | visual | fields it uses |
|---|---|---|
| `plan`, `ship` | stacked cards | `bullets` (≤5) |
| `explore` | file tree with an animated scan that lights up relevant files | `tree` (≤12 rows, `hit:true` on the ones that mattered), `root` |
| `edit`, `fix` | code editor with lines striking out and sliding in | `diff.lines` (≤14; `t` is `"+"`, `"-"` or `" "`) |
| `run`, `test` | terminal with the command typing out, then output and animated ✓/✗ checks | `terminal.cmd` (≤64 chars), `terminal.output` (≤9 lines), `checks` |
| `decide` | options that dim away while the chosen one lights up | `options` (2–3, one `chosen:true`) |

Any kind falls back to cards if its visual fields are missing, and `fix` can use
`terminal` instead of `diff` if the fix was a command. `files` (≤6) shows as chips under the
narration on any step.

**Diffs must be real.** Take them from `git diff` or the edited file, trim to the
4–12 lines that tell the story, and keep each line under ~70 characters (shorten long
lines with `…`). Never fabricate code or test output. Strip anything secret-looking.

`stats` should come from the gather totals / `git diff --shortstat`. Omit any you don't know.
`done` is shown on the last slide only when there are no `blockers`.

### Voice narration (only when asked)

Recaps are **silent by default**. Only add a voice when the user asks for one ("with voice",
"narrated", "read it out", names a voice, or passes `--tts`). When they don't, skip `voiceover`
fields and build without `--tts`.

When narration is on, the player reads each scene aloud and holds each slide until the voice finishes.
By default it speaks `title. narration`. That reads fine, but written text often sounds
stiff when spoken, so **add a `voiceover` string to any step whose on-screen text
wouldn't sound natural read aloud**, plus `"voiceover": {"intro": "...", "outro": "..."}` at the top level if needed.

Writing for the ear:
- Talk like a teammate at standup: "So the big one today — PDF previews were painfully slow…"
- No file paths, symbols or markup. Say "the PDF preview code", not `src/preview/pdf.ts`; "PR one forty-two", not "#142".
- Write numbers the way you'd say them: "about eight seconds down to under one".
- 15–45 words per scene. The voice sets the pace, so long voiceovers make a long recap.
- Keep it consistent with what's on screen; the voiceover expands on the slide, it doesn't contradict it.

Check what will be spoken with `node build.js recap.json --print-script`.

## 5. Build and hand it over

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build.js" .standup/recaps/recap.json
```

It validates the JSON (fix and rerun if it complains) and writes a single HTML file to
`.standup/recaps/<date>-<slug>.html`.

With no flags the recap is silent: no voice controls, the start screen just says **Play**.
Narration options, only when the user asked for a voice:

| flag | voice | needs |
|---|---|---|
| `--tts kokoro [--voice af_heart]` | **default when a voice is asked for.** Free open-source Kokoro voice, generated locally and embedded as audio | Python 3; first run sets up `~/.standup/kokoro-venv` and downloads ~120 MB of model files to `~/.standup/voices` |
| `--tts openai [--voice coral]` | OpenAI TTS, embedded in the file as audio | `OPENAI_API_KEY` |
| `--tts elevenlabs [--voice <voice id>]` | ElevenLabs, embedded as audio | `ELEVENLABS_API_KEY` |
| `--audio-dir <dir>` | the user's own recordings: `0.mp3` intro, `1.mp3`… steps, last = wrap-up | the files |

When a voice is asked for, use `--tts kokoro` unless the user named another option. Generation takes roughly
5–10 seconds per scene, so run it in the background if your harness allows and tell the user it's
voicing. The first run also takes a minute or two for setup. Good Kokoro voices: `af_heart` (warm, default), `af_bella`,
`am_michael`, `am_fenrir`, `bf_emma` and `bm_george` (British). Use the one the user names. If the user wants
a paid AI voice instead, check whether `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` is set
(`[ -n "$OPENAI_API_KEY" ]`) and use it. Never print or log the key. If TTS fails, the build still succeeds as a silent recap; tell the user why. Open it for the user if you can
(`open` on macOS, `xdg-open` on Linux, `start` on Windows).

Then tell the user, in two or three lines: where the file is, the one-sentence
summary, and how to drive it: it opens on a start screen with **Play** (or **Play with
narration** / **Play silently** if it was voiced); **← →** steps, **space** pauses, **V** toggles
the voice when there is one, **F** is fullscreen, and `?step=3` in the URL jumps to a step. It's a single file, so it can be
opened in any browser or screen-shared directly.

### MP4 export (only when asked)

If the user wants a video ("as an mp4", "export a video"), export the built HTML:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/export.js" .standup/recaps/<date>-<slug>.html
```

It plays the recap in headless Chrome, records it at 1600x900 and lays the embedded voice clips
over it, writing the `.mp4` next to the HTML. It takes about as long as the recap runs. It needs
ffmpeg and Playwright (`npm i -g playwright`); if either is missing, tell the user the one command
to install it. A silent recap exports as a silent video.

## Things that make a recap bad

- More than 7 steps, or steps that are just tool calls ("Read file", "Ran grep").
- Narration that restates the title.
- Made-up numbers, diffs or test results.
- Burying a failure. If the tests are red, step one of the wrap-up is the blocker.
