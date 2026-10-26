# macOS helper crash: changes and diagnostic tests

The supplied GitHub Actions log confirms an `osascript` / JavaScriptCore native crash, rather than a normal spelling exception. The previous error handling retained only the end of stderr, discarding the exception header and any evidence of which bridge operation failed. The Obsidian setup hook then repeatedly relaunched the crashing helper for a minute.

## Corrections

- Removed manual `NSAutoreleasePool` creation and draining from JXA. Draining a pool can invalidate Objective-C objects still referenced by JavaScript wrappers. This is a suspected cause of the reported bridge crash; the truncated stack alone cannot prove the failing operation.
- Read UTF-8 input as raw data until a newline, then decode the complete line. The previous reader tried to decode each individual byte as UTF-8, which can produce nil strings for accented or non-Latin words.
- Record non-sensitive stage markers before imports, startup, input decoding, native spelling, suggestions, and response writing.
- Wait for the subprocess `close` event before reporting a crash, preserving the final stderr, exception header, exit code, signal, and last stage. Diagnostic reports retain up to 64 KiB of stderr.
- Fail Obsidian setup immediately on a helper crash, and include helper diagnostics in `artifacts/native-spellcheck.json`.

## Mac CI tests

Run `npm run test:native` on macOS. This runs before the Obsidian suite in GitHub Actions.

| Test | What it distinguishes |
|---|---|
| Foundation Unicode probe | Import / string-data conversion failure |
| AppKit startup probe | Spellchecker initialization failure |
| Native selectors probe | Spelling, NSRange, or suggestion-array bridging failure |
| Legacy manual-pool control | Records whether the old lifetime pattern crashes on this OS/JXA version; informational only |
| Standalone startup and native check | Real production helper failure without Electron involved |
| 71 requests through one helper | Object lifetime or repeated-request failure |
| Split UTF-8, batched requests, EOF | Stream decoding, framing, and shutdown failure |

Read `artifacts/native/REPORT.md`, `helper-results.json`, and `macos-probes.json` from the `test-failures-macos-latest` artifact. Despite its historical name, the artifact is now uploaded on both success and failure. Stage markers contain operation names, not words from notes.

For example, `stage=spelling.check` indicates that input decoding completed but the native spelling call did not return. If all standalone tests pass but Obsidian fails, compare the embedded helper diagnostics in `native-spellcheck.json` with the standalone trace.

## Verification boundary

These changes can be built and regression-tested on Windows. A successful Mac Actions run is still required to confirm that they resolve the supplied Mac crash. No local Mac execution is available in this workspace.
