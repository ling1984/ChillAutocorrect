import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { isTrigger, type Settings } from './settings';
import { precedingWord, isProse, type Word } from './words';
import { electronSpellchecker, firstCorrection, type Spellchecker } from './spellcheck';

export interface Runtime {
  settings: Settings;
  generation: number;
  active: boolean;
  status(message: string): void;
}

export const autoCorrection = Annotation.define<boolean>();
interface Pending { state: EditorState; word: Word; key: string; generation: number }
interface Restore { state: EditorState; from: number; to: number; original: string; generation: number }

export function autoCorrectExtension(runtime: Runtime, factory: (win: Window) => Spellchecker = electronSpellchecker) {
  return Prec.highest(ViewPlugin.fromClass(class {
    pending: Pending | null = null;
    restore: Restore | null = null;
    serial = 0;
    destroyed = false;
    constructor(readonly view: EditorView) {}

    reset() { this.pending = null; this.restore = null; this.serial++; }

    keydown(event: KeyboardEvent): boolean {
      const restore = this.restore;
      this.reset();
      if (!runtime.active || !runtime.settings.enabled || this.view.state.readOnly || event.isComposing || this.view.composing || event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key === 'Backspace' && !event.shiftKey && restore?.state === this.view.state && restore.generation === runtime.generation) {
        this.view.dispatch({
          changes: { from: restore.from, to: restore.to, insert: restore.original },
          annotations: [autoCorrection.of(true), Transaction.userEvent.of('auto-correct.restore'), isolateHistory.of('full')],
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

    update(update: ViewUpdate) {
      // Viewport measurements and layout updates are not user actions.
      if (!update.transactions.length) return;
      const pending = this.pending;
      this.pending = null;
      this.restore = null;
      this.serial++;
      if (!pending || update.startState !== pending.state || !update.docChanged ||
        update.transactions.some(tr => tr.annotation(autoCorrection) || !tr.isUserEvent('input')) ||
        update.state.selection.ranges.length !== 1 || !update.state.selection.main.empty) return;
      let insertion: string | null = null;
      let count = 0;
      update.changes.iterChanges((from, to, _fromB, _toB, text) => {
        count++;
        if (from === pending.word.to && to === from) insertion = text.toString();
      });
      const expected = pending.key === 'Enter' ? '\n' : pending.key === 'Tab' ? '\t' : pending.key;
      // Enter may also insert list prefixes; Tab may insert spaces.
      if (count !== 1 || insertion === null || !(pending.key === 'Tab' ? /^[\t ]+$/u.test(insertion) : (insertion as string).startsWith(expected))) return;
      const state = update.state;
      const serial = this.serial;
      void this.correct(pending, state, serial);
    }

    async correct(pending: Pending, state: EditorState, serial: number) {
      try {
        const win = this.view.dom.ownerDocument.defaultView;
        if (!win) return;
        const correction = await firstCorrection(pending.word.text, factory(win));
        if (this.destroyed || this.serial !== serial || !runtime.active || runtime.generation !== pending.generation ||
          !runtime.settings.enabled || this.view.state !== state || !this.view.hasFocus) return;
        runtime.status('Native spellcheck ready.');
        if (!correction) return;
        this.view.dispatch({
          changes: { from: pending.word.from, to: pending.word.to, insert: correction },
          annotations: [autoCorrection.of(true), Transaction.userEvent.of('auto-correct'), isolateHistory.of('full')],
        });
        this.restore = { state: this.view.state, from: pending.word.from, to: pending.word.from + correction.length, original: pending.word.text, generation: runtime.generation };
      } catch (error) {
        if (!this.destroyed && this.serial === serial && runtime.active && runtime.generation === pending.generation) {
          runtime.status(`Autocorrect paused: ${error instanceof Error ? error.message : 'Native spellcheck failed.'} Will retry on the next trigger.`);
        }
      }
    }

    destroy() { this.destroyed = true; this.reset(); }
  }, {
    eventHandlers: {
      keydown(event) { return this.keydown(event); },
      pointerdown() { this.reset(); },
      blur() { this.reset(); },
      compositionstart() { this.reset(); },
      paste() { this.reset(); },
      drop() { this.reset(); },
    },
  }));
}
