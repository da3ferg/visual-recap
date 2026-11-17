#!/usr/bin/env python3
"""standup-recap: free, offline narration with the open-source Kokoro voice (Apache-2.0).

usage: kokoro_tts.py <scripts.json> <out_dir> [--voice af_heart] [--speed 1.0] [--models <dir>]

scripts.json is a JSON list of strings (one per scene). Writes <out_dir>/0.mp3, 1.mp3, ...
(or .wav if ffmpeg isn't installed). Model files are downloaded once from the kokoro-onnx
GitHub release into ~/.standup/voices/ (about 120 MB) and reused after that.
"""
import json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {"model": "kokoro-v1.0.int8.onnx", "voices": "voices-v1.0.bin"}


def arg(flag, default=None):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        v = sys.argv[i + 1]
        del sys.argv[i:i + 2]
        return v
    return default


voice = arg("--voice", os.environ.get("STANDUP_VOICE", "af_heart"))
speed = float(arg("--speed", "1.0"))
models = Path(arg("--models", os.environ.get("STANDUP_VOICE_DIR", Path.home() / ".standup" / "voices"))).expanduser()
if len(sys.argv) < 3:
    sys.exit(__doc__)
scripts = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
except ImportError:
    sys.exit("MISSING_DEPS: pip install kokoro-onnx soundfile")

models.mkdir(parents=True, exist_ok=True)
for name in FILES.values():
    p = models / name
    if not p.exists() or p.stat().st_size < 1_000_000:
        print(f"downloading {name} (one time)…", file=sys.stderr, flush=True)
        tmp = p.with_suffix(p.suffix + ".part")
        urllib.request.urlretrieve(RELEASE + name, tmp)
        tmp.rename(p)

k = Kokoro(str(models / FILES["model"]), str(models / FILES["voices"]))
if voice not in k.get_voices():
    sys.exit(f"unknown voice {voice!r}. Try one of: {', '.join(sorted(k.get_voices()))}")
lang = "en-gb" if voice[:1] == "b" else "en-us"
ff = shutil.which("ffmpeg")

for i, text in enumerate(scripts):
    samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
    wav = out / f"{i}.wav"
    sf.write(wav, samples, rate)
    if ff:
        subprocess.run([ff, "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-b:a", "64k", str(out / f"{i}.mp3")], check=True)
        wav.unlink()
    print(f"scene {i + 1}/{len(scripts)}: {len(samples) / rate:.1f}s", file=sys.stderr, flush=True)
