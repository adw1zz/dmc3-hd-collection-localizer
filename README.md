# dmc3-hd-collection-localizer

Command-line tool that applies a localization to **Devil May Cry 3** inside the Steam
**Devil May Cry HD Collection**. The current version localizes **audio and video**
(pre-rendered cutscenes and in-game speech); text localization is planned.

After the September 2026 patch the HD Collection stores cutscenes as WebM (VP9 + Opus)
and in-game audio as Ogg Vorbis. Old localization installers that shipped `.wmv` files no
longer work. This tool takes a folder with localized media — for example an installation of
the 2006 PC port with a localization already applied, or any prepared folder — and
re-applies it to the current game files: cutscene **video is kept as is**, only the audio
track is replaced; speech banks are copied over.

## Requirements

- **Node.js 24** or newer.
- **ffmpeg and ffprobe** on your `PATH` (any recent build). On Windows:
  `winget install Gyan.FFmpeg` — or download from <https://ffmpeg.org/download.html> and add the
  `bin` folder to `PATH`. Alternatively point the tool at a folder with `--ffmpeg-dir <dir>` or the
  `DMC3_FFMPEG_DIR` environment variable.
- The game must be **closed** while the tool runs.

## Install

```sh
git clone https://github.com/adw1zz/dmc3-hd-collection-localizer.git
cd dmc3-hd-collection-localizer
npm install
npm run build
```

Run with `node dist/main.js …`. During development `npm run start -- …` runs the TypeScript
sources directly.

## Usage

### Localize

```sh
node dist/main.js localize --source "<folder with localized files>" --target "<...>\Devil May Cry HD Collection\data\dmc3"
```

- `--source` is searched **recursively**: any file whose name (without extension) matches a game
  file is a candidate. A 2006 PC port install (`mov\*.mpg`, `sound\*.bin`) works out of the box,
  and so does a flat folder of `.webm` / `.ogg` / `.mpg` / `.wav` files with the right names.
- `--target` is the `data\dmc3` folder of the HD Collection (searched recursively as well).

The tool then:

1. **Validates** the parameters and locates ffmpeg.
2. **Analyses** both folders, pairs files by name, probes every candidate with ffprobe and prints
   a plan: what will be localized, what is skipped and why, what has no counterpart.
3. Asks for **confirmation** (`y/N`).
4. **Backs up** every original it is about to overwrite (see below).
5. **Localizes** in parallel: each output is written to a temporary file, verified with ffprobe
   and only then renamed over the original. A failure in one file never affects the others.
6. Prints a **result** summary. Exit code is `0` on success, `1` if anything failed.

Useful options (`node dist/main.js localize --help` lists them all):

| Option                   | Meaning                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `-n, --dry-run`          | Analyse and print the plan, change nothing.                     |
| `-y, --yes`              | Skip the confirmation prompt (for scripts).                     |
| `-v, --verbose`          | List every file with codec, duration and delta.                 |
| `-a, --all`              | Also replace files the tool considers non-speech (music).       |
| `-b, --backup-dir <dir>` | Where originals are stored (default `./dmc3-localizer-backup`). |
| `-j, --jobs <n>`         | Parallel ffmpeg/ffprobe processes (default: half of CPU cores). |
| `--ffmpeg-dir <dir>`     | Use ffmpeg/ffprobe from this folder.                            |
| `-m, --mode <av\|text>`  | What to localize; only `av` is implemented.                     |

### Restore

```sh
node dist/main.js restore --backup-dir "./dmc3-localizer-backup"
```

Copies every backed-up original back into the game folder after verifying its checksum.
Steam's _Verify integrity of game files_ does the same thing from Steam's side.

## What gets localized

| Category             | Target files      | Source files                                                         | How                                                                                                                                                                                       |
| -------------------- | ----------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cutscene video (FMV) | `Video\*.webm`    | `*.mpg`, `.mpeg`, `.wmv`, `.webm`, `.mkv`, `.mp4`                    | Video stream copied untouched; audio taken from the source and encoded to the target's codec/sample rate/channels (Opus 48 kHz stereo). Audio is padded or cut to the exact video length. |
| In-game speech       | `afs\sound\*.ogg` | `*.ogg`, `*.bin` (the 2006 port's `.bin` files are plain Ogg Vorbis) | Copied byte for byte when the format already matches, otherwise encoded to the target's parameters.                                                                                       |

Rules worth knowing:

- Only **speech** banks are replaced by default: names starting with `m??_` (mission cutscenes,
  boss intros) and `m_demo_`. Music (`Battle_*`, `Boss_*`, `Stage_*`, …) is excluded because the
  2006 port ships different cuts of it; pass `--all` to replace it anyway.
- A pair whose source and target durations differ by more than **3 s** is skipped as a different
  cut. Differences above **0.5 s** are reported as warnings; the audio is padded/cut to fit.
- Files that exist on one side only (language variants such as `GameOverF.webm`, placeholders like
  `dummy.ogg`, textures in `mov\ipu\`) are listed and left alone.
- A source file with no audio stream is skipped.

## Backups and repeated runs

Originals go to `./dmc3-localizer-backup/` (relative to where you run the tool), mirroring the
game's folder layout, together with `manifest.json` that records the SHA-256 of every original and
of every file the tool wrote.

- Running the tool again recognises files it already localized and skips them — the originals in
  the backup are never overwritten.
- If a target file matches neither the original nor the tool's output (Steam re-verified the game,
  another mod touched it), it is treated as a new original: a warning is printed and the backup copy
  is replaced.
- Steam's _Verify integrity of game files_ will revert the localization; just run the tool again.

## Development

```sh
npm run start -- localize …   # run from sources (tsx)
npm run check                 # typecheck + lint + format check + tests
npm run test                  # vitest (includes an end-to-end test that needs ffmpeg on PATH)
npm run build                 # tsc → dist/
```

Project layout: `src/main.ts` (CLI and pipeline), `src/cli/` (options, summary, progress),
`src/core/` (reusable modules: analyser, ffmpeg, backup, apply, console, fs) and `src/modes/`
(one folder per localization mode; `audio-video` is the only one so far). A mode is a file
specification (which target files, which source extensions) plus an `apply` function; adding text
localization means adding a mode, not changing the pipeline.

## License

MIT — see [LICENSE](LICENSE).
