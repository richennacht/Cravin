# Cravin

A private meeting copilot for your desktop. Cravin listens to both sides of a
call, translates what isn't in your language (even mid-sentence), and suggests
answers when the other side asks something. Local by default.

Cravin is a fork of [Handy](https://github.com/cjpais/handy) (MIT). Handy's
audio capture, VAD and speech models are the engine underneath.

## What works in this version

| Area                                                            | State                    |
| --------------------------------------------------------------- | ------------------------ |
| App shell, Meetings, Live, Translate, Models, Settings screens  | Done                     |
| Speech models list, download and switch (Handy's model manager) | Works in the desktop app |
| Microphone picker, theme                                        | Works in the desktop app |
| Handy's dictation shortcut and its settings (Settings → Engine) | Works in the desktop app |
| Live meeting feed, suggested answers, translation               | Demo playback only       |
| System audio capture ("Them"), turn detection, answer models    | Not built yet            |

The Live and Translate screens play a scripted meeting so the UI can be
reviewed before the engine lands. The shapes in `src/cravin/lib/demo.ts` match
what the engine will emit.

## Run it

Same toolchain as Handy (Rust stable, Bun). See [BUILD.md](BUILD.md) for
platform packages.

```bash
bun install
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://blob.handy.computer/silero_vad_v4.onnx
bun run tauri dev
```

UI only, in a browser (no backend, demo data):

```bash
bun run dev   # http://localhost:1420
```

## Layout

- `src/cravin/` Cravin's UI: `CravinShell.tsx`, `pages/`, `lib/`, `cravin.css`
- `src/` everything else is Handy's frontend (onboarding, settings components, stores)
- `src-tauri/` Handy's Rust backend, renamed to Cravin

## Next

1. System audio capture per OS (Core Audio tap on macOS 14.2+, WASAPI loopback on Windows) as a second stream.
2. Always-on dual transcription with a streaming model, then Smart Turn for end-of-turn.
3. Rolling context file per meeting and the local/API answer router.
4. Overlay hidden from screen capture.

Update checks are off: the inherited updater points at Handy's releases.
Turn it back on once Cravin has its own release feed and signing key
(`update_checks_forced_disabled` in `src-tauri/src/settings.rs`, and the
updater endpoint and pubkey in `src-tauri/tauri.conf.json`).

## License

MIT, same as Handy. See [LICENSE](LICENSE).
