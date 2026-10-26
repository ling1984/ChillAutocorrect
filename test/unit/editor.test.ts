import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autoCorrectExtension, type Runtime } from '../../src/extension';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { Spellchecker } from '../../src/spellcheck';
import { isProse, precedingWord } from '../../src/words';

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
function setup(text = 'teh', overrides: Partial<Spellchecker> = {}, extensions: Extension[] = []) {
  const runtime: Runtime = { settings: { ...DEFAULT_SETTINGS }, active: true, generation: 0, status: vi.fn() };
  const checker: Spellchecker = { isMisspelled: () => true, dictionary: async () => [], suggestions: () => ['the'], ...overrides };
  const view = new EditorView({ parent: document.body, state: EditorState.create({
    doc: text, selection: { anchor: text.length },
    extensions: [markdown(), history(), EditorState.allowMultipleSelections.of(true), keymap.of([{ key: 'Backspace', run: () => false }]), autoCorrectExtension(runtime, () => checker), ...extensions],
  }) });
  view.focus();
  views.push(view);
  return { view, runtime };
}
function trigger(view: EditorView, key = ' ', insert = key) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  view.dispatch({ changes: { from: view.state.selection.main.head, insert }, selection: { anchor: view.state.selection.main.head + insert.length }, annotations: Transaction.userEvent.of('input.type') });
}

describe('editor transactions', () => {
  it('corrects with the delimiter and cursor preserved, then separately undoes', async () => {
    const { view } = setup();
    trigger(view); await flush();
    expect(view.state.doc.toString()).toBe('the ');
    expect(view.state.selection.main.head).toBe(4);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('teh ');
  });
  it('immediate Backspace restores the original and retains the trigger', async () => {
    const { view } = setup(); trigger(view); await flush();
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('teh ');
    expect(view.state.selection.main.head).toBe(4);
  });
  it('clears Backspace restoration on an intervening key', async () => {
    const { view } = setup(); trigger(view); await flush();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('the ');
  });
  it.each(['edit', 'selection', 'settings', 'unload', 'destroy', 'pointer'])('discards results after %s', async action => {
    let resolve!: (words: string[]) => void;
    const { view, runtime } = setup('teh', { dictionary: () => new Promise(r => { resolve = r; }) });
    trigger(view);
    if (action === 'edit') view.dispatch({ changes: { from: 4, insert: 'x' } });
    if (action === 'selection') view.dispatch({ selection: { anchor: 0 } });
    if (action === 'settings') runtime.generation++;
    if (action === 'unload') runtime.active = false;
    if (action === 'destroy') view.destroy();
    if (action === 'pointer') view.contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    resolve([]); await flush();
    expect(view.state.doc.toString()).toBe(action === 'edit' ? 'teh x' : 'teh ');
  });
  it('skips input without a matching keyboard trigger (paste)', async () => {
    const { view } = setup();
    view.dispatch({ changes: { from: 3, insert: ' ' }, annotations: Transaction.userEvent.of('input.paste') });
    await flush(); expect(view.state.doc.toString()).toBe('teh ');
  });
  it('reports dictionary failures without changing the word', async () => {
    const { view, runtime } = setup('teh', { dictionary: async () => { throw new Error('not ready'); } });
    trigger(view); await flush(); expect(view.state.doc.toString()).toBe('teh ');
    expect(runtime.status).toHaveBeenCalledWith(expect.stringContaining('paused'));
  });
  it('skips selections', async () => {
    const { view } = setup();
    view.dispatch({ selection: EditorSelection.range(0, 3) }); trigger(view); await flush();
    expect(view.state.doc.toString()).not.toContain('the');
  });
  it('skips multiple cursors', async () => {
    const { view } = setup('teh teh');
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)]) });
    trigger(view); await flush(); expect(view.state.doc.toString()).not.toContain('the');
  });
  it('skips read-only editors', async () => {
    const { view } = setup('teh', {}, [EditorState.readOnly.of(true)]);
    trigger(view); await flush(); expect(view.state.doc.toString()).toBe('teh ');
  });
  it.each(['composition', 'shortcut', 'disabled'])('skips %s input', async mode => {
    const { view, runtime } = setup();
    if (mode === 'disabled') runtime.settings.enabled = false;
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, isComposing: mode === 'composition', ctrlKey: mode === 'shortcut' }));
    view.dispatch({ changes: { from: 3, insert: ' ' }, annotations: Transaction.userEvent.of('input.type') });
    await flush(); expect(view.state.doc.toString()).toBe('teh ');
  });
  it('maps the cursor for suggestions with a different length', async () => {
    const { view } = setup('teh', { suggestions: () => ['longer'] });
    trigger(view); await flush(); expect(view.state.selection.main.head).toBe(7);
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('teh '); expect(view.state.selection.main.head).toBe(4);
  });
  it('retries after a dictionary failure', async () => {
    let failed = true;
    const { view } = setup('teh', { dictionary: async () => { if (failed) throw new Error('loading'); return []; } });
    trigger(view); await flush(); expect(view.state.doc.toString()).toBe('teh ');
    failed = false;
    view.dispatch({ changes: { from: 0, to: 4, insert: 'teh' }, selection: { anchor: 3 } });
    trigger(view); await flush(); expect(view.state.doc.toString()).toBe('the ');
  });
  it('clears Backspace restoration after settings change', async () => {
    const { view, runtime } = setup(); trigger(view); await flush(); runtime.generation++;
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('the ');
  });
});

describe('Markdown context', () => {
  it.each([
    ['teh', true], ['# teh', true], ['[teh](https://example.com)', true],
    ['`teh`', false], ['```js\nteh\n```', false], ['    teh', false],
    ['[title](https://example.com/teh)', false], ['https://example.com/teh', false],
    ['[[teh]]', false], ['#teh', false], ['<span>teh</span>', false],
    ['<!-- teh -->', false], ['---\nname: teh\n---', false],
    ['$teh$', false], ['$$teh$$', false], ['$x$ teh', true], ['$$x$$ teh', true],
    ['---\nname: example\n---\nteh', true],
  ])('%s prose=%s', (doc, expected) => {
    const to = doc.indexOf('teh') + 3;
    const state = EditorState.create({ doc, extensions: [markdown()] });
    expect(isProse(state, precedingWord(doc, to)!)).toBe(expected);
  });
});
