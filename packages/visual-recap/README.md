# visual-recap

Animated, narrated standup recaps of what your coding agent did. It reads the session history
Claude Code and Codex already keep on your machine, and turns a short `recap.json` story into one
self-contained HTML player, with an optional free local voice (Kokoro) and MP4 export.

It is the engine behind the `standup-recap` plugin for Claude Code and Codex:
https://github.com/da3ferg/visual-recap

```bash
npx -y visual-recap gather                       # today's timeline for this project
npx -y visual-recap example recap.json           # a full sample story
npx -y visual-recap build recap.json --tts kokoro
npx -y visual-recap export .standup/recaps/<file>.html
```

- `gather [--day D | --since D] [--source claude|codex|all] [--session ID]`: compact, redacted timeline.
- `build <recap.json> [out.html] [--tts kokoro|openai|elevenlabs] [--voice X] [--print-script]`.
- `export <recap.html> [out.mp4]`: needs ffmpeg and Playwright.

Session files are read locally and never sent anywhere. MIT licensed.
