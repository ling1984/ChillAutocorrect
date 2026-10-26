# Native spellchecker fix — 26 October 2026

**Windows fix verified in Obsidian 1.14.4 (Electron 43.7.7).**

The original implementation asked Electron’s `webFrame` APIs about `typograpy`. They returned `false` for “misspelled” and an empty suggestions list, although Obsidian’s native spelling menu identified the typo.

The plugin now calls the OS directly in a hidden background helper. It still reads Obsidian’s session dictionary before checking a word, and preserves the existing asynchronous edit/cursor guards.

| Check for `typograpy` | Result on Windows |
|---|---|
| Old Electron renderer API | Not misspelled; no suggestions |
| Obsidian native menu | `typography`, `typograph`, `typo grapy` |
| New direct Windows API | `typography`, `typograph`, `typo grapy` |
| Installed plugin files | `main.js` and `manifest.json` |

## Automated verification

- Type checking and production build pass.
- 78 unit/editor/protocol tests pass.
- Three standalone native-helper tests pass on Windows, including repeated Unicode requests and split UTF-8 input. Mac-only probes are skipped on Windows.
- All 19 Windows tests pass in real Obsidian: Source and Live Preview, Space/Enter/Tab/punctuation, cursor positioning, Undo, Backspace restoration, Markdown exclusions, link labels, native custom-dictionary additions/removals, settings persistence, reload, and pop-out windows.
- macOS uses an implemented `NSSpellChecker` helper. Its native execution is **not verified on this Windows machine**. The macOS GitHub Actions job is required before claiming Mac compatibility.

## Reproduce

```sh
npm ci
npm run check
npm run test:native
npm run test:e2e
npm run test:e2e -- --spec test/diagnostic/native.e2e.ts
```

The last command prints the API comparison and writes `artifacts/DIAGNOSIS.md`. Native tests use a disposable vault/profile; dictionary tests also briefly add and remove an OS dictionary entry, so CI/disposable OS accounts are recommended.

After rebuilding, copy `main.js` and `manifest.json` to your vault’s `.obsidian/plugins/auto-correct/` directory and reload the plugin.

Mac CI diagnostics confirmed an invalid manual autorelease pool and JavaScript-null/Objective-C-nil argument confusion. Both have been patched. See [MACOS-DIAGNOSIS.md](MACOS-DIAGNOSIS.md); the revised helper still requires a successful Mac run.
