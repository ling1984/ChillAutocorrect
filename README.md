# Auto Correct for Obsidian

A desktop-only autocorrect plugin for Obsidian **1.14.4 or newer**. When you finish a word with Space, it uses the first suggestion from the operating system’s native spellchecker. It protects words saved in Obsidian’s custom dictionary. Windows and macOS can suggest different corrections.

## Install

1. Run `npm ci` and `npm run build` (Node.js 22 required).
2. Create `<vault>/.obsidian/plugins/auto-correct/` (use your vault’s configuration directory if customized).
3. Copy `main.js` and `manifest.json` into that folder.
4. Reload Obsidian and enable **Auto Correct** in Settings → Community plugins.

The generated `main.js` is included in this repository. To install without Node.js, copy it and `manifest.json` as above.

## Use

Space is the default trigger. In Settings → Auto Correct, enable Enter, Tab, or individual punctuation characters. Each character in the punctuation field is a separate trigger; apostrophes and underscores are excluded. Changes take effect immediately. Tab retains Obsidian’s normal whitespace/indentation behavior and corrects the word that was before the cursor.

Ctrl+Z (Windows) or Cmd+Z (macOS) reverses just the correction. Immediate Backspace restores the original word while keeping the trigger; the next Backspace works normally. Any intervening key, click, selection, focus change, edit or settings change clears this shortcut.

Only the completed word in prose is checked. Code, frontmatter, URLs, link targets, wiki links, tags, HTML and math are excluded. Ordinary link labels and headings can be corrected. Paste, IME composition, selections and multiple cursors are ignored. If you keep typing before a native result is ready, that result is discarded.

Spelling languages follow Obsidian’s existing configuration; macOS manages language detection through the OS. The plugin does not configure languages or send note text to a server. Electron may download its own spelling dictionaries. Add protected words through Obsidian’s existing **Add to dictionary** menu. If a required API or dictionary is unavailable, text is left unchanged and settings show a status; the next trigger retries.

The plugin uses Windows `ISpellChecker` or macOS `NSSpellChecker` through a persistent background helper. Windows PowerShell and macOS `osascript` are included with their operating systems. Helper scripts are bundled in `main.js`; there are no additional plugin files or native binaries to install. Words travel to the helper as JSON over stdin. The helper does not open a menu, change focus, or modify dictionaries. It stops when the plugin is disabled. On Windows, every spelling language selected in Obsidian must also be supported by the OS; otherwise the plugin pauses rather than correcting with an incomplete set of languages.

## Development and testing

- `npm run dev`: rebuild on changes.
- `npm run check`: type checking, unit/editor tests, and production build.
- `npm run test:native`: test the real OS helper independently of Obsidian, including repeated requests, Unicode split across writes, batched requests, and graceful EOF. macOS additionally runs isolated Objective-C bridge probes. Read `artifacts/native/REPORT.md` and the accompanying JSON files for stage traces, full crash headers, exit codes, and signals.
- `npm run test:e2e`: run real Obsidian 1.14.4 in a copied test vault and isolated application profile using WDIO Obsidian Service. Requires network access for Obsidian, ChromeDriver and native dictionaries on first run, and an interactive desktop.
- `npm run test:e2e -- --spec test/diagnostic/native.e2e.ts`: print a comparison of Electron’s renderer APIs, the native menu, and the direct OS helper; save the readable report to `artifacts/DIAGNOSIS.md`.
- Set `OBSIDIAN_BINARY` and `OBSIDIAN_APP` to use an existing executable and app ASAR with the test runner. Tests still use a disposable vault/profile.

GitHub Actions runs these checks on Windows and macOS. Direct native helper tests run before Obsidian so helper crashes are isolated from editor problems. To reproduce the confirmed legacy Mac pool crash, opt in with `AUTO_CORRECT_LEGACY_PROBE=1`; it is excluded from normal runs. Native tests compare against the current platform’s first suggestion rather than a fixed spelling. The custom-dictionary test temporarily adds a test word and removes it in `finally`; run native tests in disposable OS accounts/CI because Electron can also update the OS dictionary. Logs, native diagnostic reports, and failure screenshots are saved under `artifacts/` and uploaded by CI on every run.

Passing unit tests alone does not establish native compatibility. Both platform CI jobs must pass before claiming Windows/macOS verification. Publishing to the community plugin directory is separate from this project.

See [VERIFICATION.md](VERIFICATION.md) for the current verification results. Windows has been tested locally; macOS requires a successful run of its CI job.
