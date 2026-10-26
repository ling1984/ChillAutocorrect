"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AutoCorrectPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/extension.ts
var import_state = require("@codemirror/state");
var import_commands = require("@codemirror/commands");
var import_view = require("@codemirror/view");

// src/settings.ts
var DEFAULT_SETTINGS = {
  enabled: true,
  space: true,
  enter: false,
  tab: false,
  punctuation: ""
};
function loadSettings(data) {
  const value = data && typeof data === "object" ? data : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of ["enabled", "space", "enter", "tab"]) {
    if (typeof value[key] === "boolean") settings[key] = value[key];
  }
  settings.punctuation = normalizePunctuation(value.punctuation);
  return settings;
}
function normalizePunctuation(value) {
  return typeof value === "string" ? [...new Set([...value].filter((c) => /\p{P}/u.test(c) && !/['’_]/u.test(c)))].join("") : "";
}
function isTrigger(key, settings) {
  return settings.enabled && (key === " " && settings.space || key === "Enter" && settings.enter || key === "Tab" && settings.tab || [...key].length === 1 && settings.punctuation.includes(key));
}

// src/words.ts
var import_language = require("@codemirror/language");
function precedingWord(text, cursor) {
  const token = text.slice(0, cursor).match(/[\p{L}\p{M}\p{N}_'’]+$/u)?.[0];
  if (!token || !/^\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*$/u.test(token)) return null;
  if (/^[\p{L}\p{M}\p{N}_'’]/u.test(text.slice(cursor))) return null;
  return { from: cursor - token.length, to: cursor, text: token };
}
var EXCLUDED = /code|frontmatter|yaml|url|autolink|linkmark|linkdestination|wikilink|hmd-internal-link|hashtag|tag|html|comment|math|formatting-link/i;
function isProse(state, word) {
  const tree = (0, import_language.ensureSyntaxTree)(state, word.to, 50);
  if (!tree || tree.length < word.to) return false;
  for (const position of [word.from, Math.max(word.from, word.to - 1)]) {
    for (let node = tree.resolveInner(position, 1); node; node = node.parent) {
      if (EXCLUDED.test(node.name)) return false;
    }
  }
  const line = state.doc.lineAt(word.from);
  const before = line.text.slice(0, word.from - line.from);
  const throughWord = line.text.slice(0, word.to - line.from);
  if (/^---\s*$/u.test(state.doc.line(1).text)) {
    let closed = false;
    for (let number = 2; number <= line.number; number++) {
      if (/^(?:---|\.\.\.)\s*$/u.test(state.doc.line(number).text)) {
        closed = true;
        break;
      }
    }
    if (!closed) return false;
  }
  if (/(?:^|\s)#[^\s#]*$/u.test(before)) return false;
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return false;
  if (/(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|\b[\w.+-]+@)[^\s<>]*$/iu.test(throughWord)) return false;
  if (/!?\[[^\]]*\]\([^)]*$/u.test(before) || /^\s*\[[^\]]+\]:/u.test(line.text)) return false;
  const openTags = [];
  for (const match of before.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*>/giu)) {
    const name = match[2].toLowerCase();
    if (match[1]) {
      if (openTags.at(-1) === name) openTags.pop();
    } else if (!/\/\s*>$/u.test(match[0]) && !/^(?:br|hr|img|input|wbr|meta|link)$/u.test(name)) openTags.push(name);
  }
  if (openTags.length) return false;
  let mathDelimiter = null;
  for (const match of before.matchAll(/(?<!\\)\$\$?/gu)) {
    if (!mathDelimiter) mathDelimiter = match[0];
    else if (mathDelimiter === match[0]) mathDelimiter = null;
  }
  if (mathDelimiter) return false;
  return true;
}

// src/spellcheck.ts
function electronSpellchecker(win, native) {
  const host = win;
  const electron = host.electron ?? host.require?.("electron");
  const frame = electron?.webFrame;
  const session = electron?.remote?.getCurrentWebContents?.().session;
  if (!native && (!frame?.isWordMisspelled || !frame.getWordSuggestions) || !session?.listWordsInSpellCheckerDictionary) {
    throw new Error("Native spellcheck or custom dictionary API is unavailable.");
  }
  return {
    isMisspelled: (word) => frame.isWordMisspelled(word),
    suggestions: (word) => frame.getWordSuggestions(word),
    dictionary: () => session.listWordsInSpellCheckerDictionary(),
    ...native ? { check: (word) => native.check(word, session.getSpellCheckerLanguages?.() ?? []) } : {}
  };
}
var canonical = (word) => word.normalize("NFC").toLowerCase();
async function firstCorrection(word, checker) {
  if (!checker.check && !checker.isMisspelled(word)) return null;
  const dictionary = await checker.dictionary();
  if (!Array.isArray(dictionary) || dictionary.some((entry) => typeof entry !== "string")) {
    throw new Error("Custom dictionary could not be read.");
  }
  if (dictionary.some((entry) => canonical(entry) === canonical(word))) return null;
  const result = checker.check ? await checker.check(word) : { misspelled: true, suggestions: checker.suggestions(word) };
  if (!result.misspelled) return null;
  const suggestion = result.suggestions[0];
  return typeof suggestion === "string" && suggestion.length > 0 && suggestion !== word && !/[\r\n]/u.test(suggestion) ? suggestion : null;
}

// src/extension.ts
var autoCorrection = import_state.Annotation.define();
function autoCorrectExtension(runtime, factory = electronSpellchecker) {
  return import_state.Prec.highest(import_view.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
    }
    view;
    pending = null;
    restore = null;
    serial = 0;
    destroyed = false;
    reset() {
      this.pending = null;
      this.restore = null;
      this.serial++;
    }
    keydown(event) {
      const restore = this.restore;
      this.reset();
      if (!runtime.active || !runtime.settings.enabled || this.view.state.readOnly || event.isComposing || this.view.composing || event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key === "Backspace" && !event.shiftKey && restore?.state === this.view.state && restore.generation === runtime.generation) {
        this.view.dispatch({
          changes: { from: restore.from, to: restore.to, insert: restore.original },
          annotations: [autoCorrection.of(true), import_state.Transaction.userEvent.of("auto-correct.restore"), import_commands.isolateHistory.of("full")]
        });
        return true;
      }
      if (!isTrigger(event.key, runtime.settings)) return false;
      const state = this.view.state;
      if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const localWord = precedingWord(line.text, head - line.from);
      const word = localWord && { ...localWord, from: localWord.from + line.from, to: localWord.to + line.from };
      if (!word || !isProse(state, word)) return false;
      this.pending = { state, word, key: event.key, generation: runtime.generation };
      return false;
    }
    update(update) {
      if (!update.docChanged && !update.selectionSet && !update.transactions.some((tr) => tr.reconfigured)) return;
      const pending = this.pending;
      this.pending = null;
      this.restore = null;
      this.serial++;
      if (!pending || update.startState !== pending.state || !update.docChanged || update.transactions.some((tr) => tr.annotation(autoCorrection) || !(tr.isUserEvent("input") || pending.key === "Tab" && tr.isUserEvent("indent"))) || update.state.selection.ranges.length !== 1 || !update.state.selection.main.empty) return;
      let insertion = null;
      let count = 0;
      let validTab = true;
      update.changes.iterChanges((from, to, _fromB, _toB, text) => {
        count++;
        if (from === pending.word.to && to === from) insertion = text.toString();
        if (from !== to || from > pending.word.from && from !== pending.word.to || !/^[\t ]+$/u.test(text.toString())) validTab = false;
      });
      const expected = pending.key === "Enter" ? "\n" : pending.key === "Tab" ? "	" : pending.key;
      if (pending.key === "Tab") {
        if (count === 0 || !validTab) return;
        pending.word = {
          ...pending.word,
          from: update.changes.mapPos(pending.word.from, 1),
          to: update.changes.mapPos(pending.word.to, -1)
        };
        if (update.state.doc.sliceString(pending.word.from, pending.word.to) !== pending.word.text) return;
      } else if (count !== 1 || insertion === null || !insertion.startsWith(expected)) return;
      const state = update.state;
      const serial = this.serial;
      void this.correct(pending, state, serial);
    }
    async correct(pending, state, serial) {
      try {
        const win = this.view.dom.ownerDocument.defaultView;
        if (!win) return;
        const correction = await firstCorrection(pending.word.text, factory(win));
        if (this.destroyed || this.serial !== serial || !runtime.active || runtime.generation !== pending.generation || !runtime.settings.enabled || this.view.state.doc !== state.doc || !this.view.state.selection.eq(state.selection) || !this.view.hasFocus) return;
        runtime.status("Native spellcheck ready.");
        if (!correction) return;
        this.view.dispatch({
          changes: { from: pending.word.from, to: pending.word.to, insert: correction },
          annotations: [autoCorrection.of(true), import_state.Transaction.userEvent.of("auto-correct"), import_commands.isolateHistory.of("full")]
        });
        this.restore = { state: this.view.state, from: pending.word.from, to: pending.word.from + correction.length, original: pending.word.text, generation: runtime.generation };
      } catch (error) {
        if (!this.destroyed && this.serial === serial && runtime.active && runtime.generation === pending.generation) {
          runtime.status(`Autocorrect paused: ${error instanceof Error ? error.message : "Native spellcheck failed."} Will retry on the next trigger.`);
        }
      }
    }
    destroy() {
      this.destroyed = true;
      this.reset();
    }
  }, {
    eventHandlers: {
      keydown(event) {
        return this.keydown(event);
      },
      pointerdown() {
        this.reset();
      },
      blur() {
        this.reset();
      },
      compositionstart() {
        this.reset();
      },
      paste() {
        this.reset();
      },
      drop() {
        this.reset();
      }
    }
  }));
}

// src/native-spellchecker.ts
var import_node_child_process = require("node:child_process");
var import_node_buffer = require("node:buffer");
var import_node_path = __toESM(require("node:path"));

// src/native-scripts.ts
var WINDOWS_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellCheckerFactory {
    IEnumString GetSupportedLanguages();
    [return: MarshalAs(UnmanagedType.Bool)] bool IsSupported([MarshalAs(UnmanagedType.LPWStr)] string language);
    ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string language);
}
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellChecker {
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetLanguageTag();
    IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text);
    IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
}
[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumSpellingError {
    [PreserveSig] int Next(out IntPtr error);
}
public class NativeSpellingResult {
    public bool Misspelled;
    public string[] Suggestions;
}
public static class NativeSpelling {
    static readonly ISpellCheckerFactory Factory = (ISpellCheckerFactory)Activator.CreateInstance(
        Type.GetTypeFromCLSID(new Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")));
    static readonly Dictionary<string, ISpellChecker> Checkers = new Dictionary<string, ISpellChecker>();
    public static NativeSpellingResult Check(string word, string[] languages) {
        if (languages == null || languages.Length == 0) throw new Exception("No spelling languages configured in Obsidian.");
        // Do not correct using only a subset of the configured languages.
        foreach (string language in languages) {
            if (!Factory.IsSupported(language)) throw new Exception("Windows spelling language unavailable: " + language);
        }
        var suggestions = new List<string>();
        foreach (string language in languages) {
            ISpellChecker checker;
            if (!Checkers.TryGetValue(language, out checker)) {
                checker = Factory.CreateSpellChecker(language);
                Checkers.Add(language, checker);
            }
            var errors = checker.Check(word);
            IntPtr error;
            int hr;
            try { hr = errors.Next(out error); }
            finally { Marshal.ReleaseComObject(errors); }
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            if (error == IntPtr.Zero) return new NativeSpellingResult { Misspelled = false, Suggestions = new string[0] };
            Marshal.Release(error);
            var guesses = checker.Suggest(word);
            try {
                var item = new string[1];
                while (guesses.Next(1, item, IntPtr.Zero) == 0 && suggestions.Count < 32) {
                    if (!suggestions.Contains(item[0])) suggestions.Add(item[0]);
                }
            } finally { Marshal.ReleaseComObject(guesses); }
        }
        return new NativeSpellingResult { Misspelled = true, Suggestions = suggestions.ToArray() };
    }
}
'@
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $result = [NativeSpelling]::Check([string]$request.word, [string[]]$request.languages)
        $response = @{ id = $request.id; misspelled = $result.Misspelled; suggestions = @($result.Suggestions) }
    } catch {
        $response = @{ id = $request.id; error = $_.Exception.Message }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 4))
}
`;
var MACOS_SPELLING = String.raw`
function checkNativeWord(word) {
    const text = $(word);
    stage('spelling.check');
    const range = checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount(text, 0, $(), false, tag, Ref());
    const misspelled = Number(range.length) > 0;
    stage('spelling.suggest');
    const guesses = misspelled ? checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(range, text, $(), tag) : undefined;
    const suggestions = guesses ? ObjC.deepUnwrap(guesses) : [];
    return { misspelled: misspelled, suggestions: Array.isArray(suggestions) ? suggestions : [] };
}
`;
var MACOS_HELPER = String.raw`
function stage(name) { console.log('AUTO_CORRECT_STAGE:' + name); }
stage('foundation.import');
ObjC.import('Foundation');
stage('appkit.import');
ObjC.import('AppKit');
stage('stdio.open');
const input = $.NSFileHandle.fileHandleWithStandardInput;
const output = $.NSFileHandle.fileHandleWithStandardOutput;
const newline = $('\n').dataUsingEncoding($.NSUTF8StringEncoding);
stage('spellchecker.create');
const checker = $.NSSpellChecker.sharedSpellChecker;
const tag = $.NSSpellChecker.uniqueSpellDocumentTag;
checker.automaticallyIdentifiesLanguages = true;
stage('spellchecker.ready');
function write(value) {
    output.writeData($(JSON.stringify(value) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function readLine() {
    const data = $.NSMutableData.data;
    while (true) {
        const byte = input.readDataOfLength(1);
        if (Number(byte.length) === 0) { stage('input.eof'); return null; }
        // Compare raw bytes: an individual UTF-8 byte may not be a valid NSString.
        if (byte.isEqualToData(newline)) {
            stage('input.decode');
            return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
        }
        data.appendData(byte);
    }
}
write({ready: true});
stage('ready.sent');
${MACOS_SPELLING}
while (true) {
    // Transport errors are fatal, not per-word errors: retrying a broken read
    // forever hides the original failure and prevents EOF/shutdown diagnostics.
    stage('input.wait');
    const line = readLine();
    if (line === null) break;
    let request;
    // JXA owns its bridged objects. Draining a manually created pool can
    // invalidate wrappers that JavaScriptCore still references on the next loop.
    try {
        stage('request.parse');
        request = JSON.parse(line);
        const result = checkNativeWord(request.word);
        stage('response.write');
        write({ id: request.id, misspelled: result.misspelled, suggestions: result.suggestions });
        stage('request.complete');
    } catch (error) {
        write({ id: request ? request.id : null, error: String(error) });
    }
}
stage('shutdown');
checker.closeSpellDocumentWithTag(tag);
stage('shutdown.complete');
`;

// src/native-spellchecker.ts
function helperCommand(platform) {
  if (platform === "win32") return {
    executable: import_node_path.default.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", import_node_buffer.Buffer.from(WINDOWS_HELPER, "utf16le").toString("base64")]
  };
  if (platform === "darwin") return { executable: "/usr/bin/osascript", args: ["-l", "JavaScript", "-e", MACOS_HELPER] };
  throw new Error("Native autocorrect supports Windows and macOS.");
}
var NativeSpellchecker = class {
  constructor(platform = process.platform, launch = import_node_child_process.spawn) {
    this.platform = platform;
    this.launch = launch;
    this.diagnostic = { platform, stages: [], stderr: "", exitCode: null, signal: null };
  }
  platform;
  launch;
  child;
  ready;
  closed = false;
  id = 0;
  diagnostic;
  requests = /* @__PURE__ */ new Map();
  diagnostics() {
    return { ...this.diagnostic, stages: [...this.diagnostic.stages] };
  }
  async start() {
    if (this.closed) return Promise.reject(new Error("Native spellchecker is closed."));
    if (this.ready) return this.ready;
    const { executable, args } = helperCommand(this.platform);
    const child = this.launch(executable, args, { windowsHide: true, stdio: "pipe" });
    this.child = child;
    this.diagnostic = { platform: this.platform, stages: [], stderr: "", exitCode: null, signal: null };
    this.ready = new Promise((resolve, reject) => {
      let buffer = "";
      let stderr = "";
      let stderrBuffer = "";
      const startupTimer = setTimeout(() => fail(new Error("Native spellchecker startup timed out.")), 15e3);
      const fail = (error) => {
        clearTimeout(startupTimer);
        reject(error);
        if (this.child !== child) return;
        this.child = void 0;
        this.ready = void 0;
        for (const request of this.requests.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        this.requests.clear();
        child.kill();
      };
      child.on("error", (error) => fail(new Error(`Could not start native spellchecker: ${error.message}`)));
      child.on("close", (code, signal) => {
        if (this.child !== child) return;
        this.diagnostic.exitCode = code;
        this.diagnostic.signal = signal;
        const lastStage = this.diagnostic.stages.at(-1);
        const header = stderr.split("\n").filter((line) => !line.includes("AUTO_CORRECT_STAGE:")).join("\n").trim().slice(0, 4e3);
        fail(new Error(`Native spellchecker exited (code=${code}, signal=${signal ?? "none"}${lastStage ? `, stage=${lastStage}` : ""}).${header ? ` ${header}` : ""}`));
      });
      child.stdin.on("error", (error) => fail(error));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data) => {
        if (this.child !== child) return;
        stderr += data;
        if (stderr.length > 65536) stderr = stderr.slice(0, 32768) + "\n[stderr truncated]\n" + stderr.slice(-32768);
        this.diagnostic.stderr = stderr;
        stderrBuffer += data;
        let newline;
        while ((newline = stderrBuffer.indexOf("\n")) !== -1) {
          const line = stderrBuffer.slice(0, newline);
          stderrBuffer = stderrBuffer.slice(newline + 1);
          const marker = line.match(/AUTO_CORRECT_STAGE:([a-z.]+)/u)?.[1];
          if (marker) this.diagnostic.stages = [...this.diagnostic.stages.slice(-63), marker];
        }
        if (stderrBuffer.length > 65536) stderrBuffer = stderrBuffer.slice(-1024);
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          fail(new Error("Native spellchecker response too large."));
          return;
        }
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const value = JSON.parse(line);
            if (value.ready === true) {
              clearTimeout(startupTimer);
              resolve();
              continue;
            }
            const request = this.requests.get(value.id);
            if (!request) continue;
            this.requests.delete(value.id);
            clearTimeout(request.timer);
            if (typeof value.error === "string") request.reject(new Error(value.error));
            else if (typeof value.misspelled !== "boolean" || !Array.isArray(value.suggestions) || value.suggestions.some((s) => typeof s !== "string")) {
              request.reject(new Error("Invalid response from native spellchecker."));
            } else request.resolve({ misspelled: value.misspelled, suggestions: value.suggestions });
          } catch {
            fail(new Error("Invalid JSON from native spellchecker."));
            return;
          }
        }
      });
    });
    return this.ready;
  }
  async check(word, languages) {
    await this.start();
    if (!this.child || this.closed) throw new Error("Native spellchecker is unavailable.");
    const child = this.child;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Native spellcheck request timed out."));
        if (this.child === child) child.kill();
      }, 3e3);
      this.requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, word, languages }) + "\n");
    });
  }
  stop() {
    this.closed = true;
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Native spellchecker closed."));
    }
    this.requests.clear();
    this.child?.kill();
  }
};

// src/main.ts
var AutoCorrectPlugin = class extends import_obsidian.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  runtime;
  nativeSpellchecker;
  statusText = "Native spellcheck will be checked on the next trigger.";
  statusEl;
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.runtime = {
      settings: this.settings,
      generation: 0,
      active: true,
      status: (message) => {
        this.statusText = message;
        if (this.statusEl) this.statusEl.textContent = message;
      }
    };
    this.nativeSpellchecker = new NativeSpellchecker();
    void this.nativeSpellchecker.start().then(
      () => this.runtime.status("Native OS spellcheck ready."),
      (error) => this.runtime.status(`Autocorrect paused: ${error.message} Will retry on the next trigger.`)
    );
    this.registerEditorExtension(autoCorrectExtension(this.runtime, (win) => electronSpellchecker(win, this.nativeSpellchecker)));
    this.addSettingTab(new AutoCorrectSettings(this));
  }
  onunload() {
    this.runtime.active = false;
    this.runtime.generation++;
    this.nativeSpellchecker?.stop();
    this.statusEl = void 0;
  }
  async updateSettings(patch) {
    this.settings = loadSettings({ ...this.settings, ...patch });
    this.runtime.settings = this.settings;
    this.runtime.generation++;
    await this.saveData(this.settings);
  }
  renderSettings(container) {
    container.empty();
    new import_obsidian.Setting(container).setName("Auto Correct").setHeading();
    container.createEl("p", { text: "Correct the completed word using the first native suggestion. Words in your Obsidian dictionary are preserved. Undo reverses a correction; immediate Backspace restores the word and keeps the trigger." });
    this.statusEl = container.createEl("p", { text: this.statusText, attr: { role: "status" } });
    for (const [key, label] of [["enabled", "Enable autocorrect"], ["space", "Space"], ["enter", "Enter"], ["tab", "Tab"]]) {
      new import_obsidian.Setting(container).setName(label).addToggle((toggle) => toggle.setValue(this.settings[key]).onChange((value) => this.updateSettings({ [key]: value })));
    }
    new import_obsidian.Setting(container).setName("Punctuation triggers").setDesc("Each punctuation character is a trigger, for example . , ; : ! ? Apostrophes and underscores are excluded.").addText((text) => text.setPlaceholder(".,;:!?").setValue(this.settings.punctuation).onChange((value) => this.updateSettings({ punctuation: normalizePunctuation(value) })));
    container.createEl("p", { text: "Uses your existing Obsidian spelling languages. On macOS, language detection is managed by the operating system. Code, metadata, links and other non-prose syntax are excluded." });
  }
};
var AutoCorrectSettings = class extends import_obsidian.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  plugin;
  display() {
    this.plugin.renderSettings(this.containerEl);
  }
};
