"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
function electronSpellchecker(win) {
  const host = win;
  const electron = host.electron ?? host.require?.("electron");
  const frame = electron?.webFrame;
  const session = electron?.remote?.getCurrentWebContents?.().session;
  if (!frame?.isWordMisspelled || !frame.getWordSuggestions || !session?.listWordsInSpellCheckerDictionary) {
    throw new Error("Native spellcheck or custom dictionary API is unavailable.");
  }
  return {
    isMisspelled: (word) => frame.isWordMisspelled(word),
    suggestions: (word) => frame.getWordSuggestions(word),
    dictionary: () => session.listWordsInSpellCheckerDictionary()
  };
}
var canonical = (word) => word.normalize("NFC").toLowerCase();
async function firstCorrection(word, checker) {
  if (!checker.isMisspelled(word)) return null;
  const dictionary = await checker.dictionary();
  if (!Array.isArray(dictionary) || dictionary.some((entry) => typeof entry !== "string")) {
    throw new Error("Custom dictionary could not be read.");
  }
  if (dictionary.some((entry) => canonical(entry) === canonical(word))) return null;
  const suggestion = checker.suggestions(word)[0];
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
      if (!update.transactions.length) return;
      const pending = this.pending;
      this.pending = null;
      this.restore = null;
      this.serial++;
      if (!pending || update.startState !== pending.state || !update.docChanged || update.transactions.some((tr) => tr.annotation(autoCorrection) || !tr.isUserEvent("input")) || update.state.selection.ranges.length !== 1 || !update.state.selection.main.empty) return;
      let insertion = null;
      let count = 0;
      update.changes.iterChanges((from, to, _fromB, _toB, text) => {
        count++;
        if (from === pending.word.to && to === from) insertion = text.toString();
      });
      const expected = pending.key === "Enter" ? "\n" : pending.key === "Tab" ? "	" : pending.key;
      if (count !== 1 || insertion === null || !(pending.key === "Tab" ? /^[\t ]+$/u.test(insertion) : insertion.startsWith(expected))) return;
      const state = update.state;
      const serial = this.serial;
      void this.correct(pending, state, serial);
    }
    async correct(pending, state, serial) {
      try {
        const win = this.view.dom.ownerDocument.defaultView;
        if (!win) return;
        const correction = await firstCorrection(pending.word.text, factory(win));
        if (this.destroyed || this.serial !== serial || !runtime.active || runtime.generation !== pending.generation || !runtime.settings.enabled || this.view.state !== state || !this.view.hasFocus) return;
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

// src/main.ts
var AutoCorrectPlugin = class extends import_obsidian.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  runtime;
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
    this.registerEditorExtension(autoCorrectExtension(this.runtime));
    this.addSettingTab(new AutoCorrectSettings(this));
  }
  onunload() {
    this.runtime.active = false;
    this.runtime.generation++;
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
