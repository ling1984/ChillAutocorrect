# macOS helper crash: changes and diagnostic tests

The first GitHub Actions log showed an `osascript` / JavaScriptCore crash with its header discarded. The subsequent staged Mac run established two distinct failures:

1. The legacy control crashes at `legacy.pool.create` with `-[NSAutoreleasePool retain]: Cannot retain an autorelease pool`. Removing manual pool management fixes this original failure.
2. The corrected helper reaches `spelling.check` but throws `-[NSNull isEqualToString:]`. JavaScript `null` was being bridged to an `NSNull` object in the language parameter, where `NSSpellChecker` expects Objective-C `nil` or an NSString.

Foundation Unicode round-tripping and AppKit initialization both passed on the Mac runner. The remaining observed failure is in argument bridging, not helper startup or dictionary downloads.

## Corrections

- Removed manual `NSAutoreleasePool` creation and draining from JXA; its creation is now a confirmed cause of the original crash.
- Pass JXA `$()` (Objective-C nil) for the language in both spelling and suggestion calls, and `Ref()` for the `NSInteger* wordCount` output. JavaScript null is not used as a native argument.
- Share the production spelling function with the isolated native-selector probe. Four cross-platform regression tests execute that function against a strict bridge contract, including a reproduction of the reported NSNull exception with the old argument.
- Read UTF-8 input as raw data until a newline, then decode the complete line. The previous reader tried to decode each individual byte as UTF-8, which can produce nil strings for accented or non-Latin words.
- Record non-sensitive stage markers before imports, startup, input decoding, native spelling, suggestions, and response writing.
- Wait for the subprocess `close` event before reporting a crash, preserving the final stderr, exception header, exit code, signal, and last stage. Diagnostic reports retain up to 64 KiB of stderr.
- Fail Obsidian setup immediately on a helper crash, and include helper diagnostics in `artifacts/native-spellcheck.json`.
- Stop treating transport read errors as per-word errors, record explicit EOF and shutdown-complete markers, and make raw-protocol tests fail immediately on a native error response rather than waiting 20 seconds.

## Mac CI tests

Run `npm run test:native` on macOS. This runs before the Obsidian suite in GitHub Actions.

| Test | What it distinguishes |
|---|---|
| Foundation Unicode probe | Import / string-data conversion failure |
| AppKit startup probe | Spellchecker initialization failure |
| Native selectors probe | Spelling, NSRange, or suggestion-array bridging failure |
| Legacy manual-pool control (opt-in) | Original pool crash is confirmed; set `AUTO_CORRECT_LEGACY_PROBE=1` to reproduce it in a disposable subprocess |
| Standalone startup and native check | Real production helper failure without Electron involved |
| 71 requests through one helper | Object lifetime or repeated-request failure |
| Split UTF-8, batched requests, EOF | Stream decoding, framing, and shutdown failure |

Read `artifacts/native/REPORT.md`, `helper-results.json`, and `macos-probes.json` from the `test-failures-macos-latest` artifact. Despite its historical name, the artifact is now uploaded on both success and failure. Stage markers contain operation names, not words from notes.

For example, `stage=spelling.check` indicates that input decoding completed but the native spelling call did not return. If all standalone tests pass but Obsidian fails, compare the embedded helper diagnostics in `native-spellcheck.json` with the standalone trace.

## Verification boundary

The supplied Mac output confirms both causes above. The revised arguments and stream handling can be built and regression-tested on Windows, but a successful Mac Actions run is still required to verify the final helper end to end. No local Mac execution is available in this workspace.

## Latest Mac editor run: 18 of 19 tests passed

After the native-argument fix, the supplied Mac run passes Source mode, Live Preview, Undo, Backspace, every configured trigger, Markdown exclusions, link labels, reload and pop-out windows. Its remaining failure occurs before any dictionary mutation: the test hard-coded `speling` and assumed that the native engine would return a suggestion. That first suggestion was absent on the Mac runner.

The dictionary test now selects an unsaved word that the current OS demonstrably marks as misspelled and provides a usable suggestion for. It proves correction before adding the word, verifies the session dictionary contains the learned word and the editor preserves it, then removes it and requires correction to resume using the current native first suggestion. It runs last to isolate OS dictionary propagation from the other editor tests.

Candidate observations and the selected fixture are saved in `artifacts/native/dictionary-fixture.json`. If no candidate is usable, the test fails with all observations rather than skipping dictionary verification. The revised dictionary test still needs a Mac run.
