import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { DEFAULT_SETTINGS, type Settings } from '../../src/settings';
import fs from 'node:fs/promises';
import { PLUGIN_ID, PLUGIN_KEY } from '../plugin-identity';

const typo = 'typograpy';
let suggestion: string;

async function settings(patch: Partial<Settings>) {
  await browser.executeObsidian(async ({ plugins }, value) => plugins.chillAutocorrect.updateSettings(value), patch);
}

async function documentText() {
  return browser.executeObsidian(({ app, obsidian }) => {
    let view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view?.containerEl.ownerDocument !== document) app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof obsidian.MarkdownView && leaf.view.containerEl.ownerDocument === document) view = leaf.view;
    });
    return view!.editor.getValue();
  });
}

async function openText(text = '', source = true, cursor?: number) {
  await browser.executeObsidian(async ({ app, obsidian }, text, source, cursor) => {
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'markdown', state: { file: 'Test.md', mode: 'source', source } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
    view.editor.setValue(text);
    view.editor.setCursor(view.editor.offsetToPos(cursor ?? text.length));
    view.editor.focus();
  }, text, source, cursor);
}

async function expectText(text: string) {
  await browser.waitUntil(async () => await documentText() === text, { timeout: 8000, timeoutMsg: `Expected document ${JSON.stringify(text)}` });
}

describe('Auto Correct in real Obsidian', () => {
  before(async () => {
    await browser.executeObsidian(({ plugins }, id, key) => {
      const plugin = plugins[key] as unknown as { updateSettings?: unknown } | undefined;
      if (!plugin || typeof plugin.updateSettings !== 'function') {
        throw new Error(`Expected plugin '${id}' at plugins.${key}; loaded plugin keys: ${Object.keys(plugins).join(', ') || '(none)'}. Check the manifest ID and plugin load errors.`);
      }
    }, PLUGIN_ID, PLUGIN_KEY);
    await browser.executeObsidian(async ({ require, obsidian }) => {
      const session = require('electron').remote.getCurrentWebContents().session;
      const events: string[] = [];
      (window as unknown as { nativeSpellcheckEvents: string[] }).nativeSpellcheckEvents = events;
      for (const name of ['spellcheck-dictionary-initialized', 'spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure']) {
        session.on(name, (_event: unknown, language: string) => events.push(`${name}: ${language}`));
      }
      session.setSpellCheckerEnabled(true);
      if (!obsidian.Platform.isMacOS) session.setSpellCheckerLanguages(['en-US']);
      await session.listWordsInSpellCheckerDictionary();
    });
    await settings({ ...DEFAULT_SETTINGS, enabled: false });
    await openText(typo);
    // Trigger Chromium's lazy dictionary loading with real editor input.
    await browser.keys(' ');
    try {
      // OS API calls are synchronous once the helper is ready. A helper crash is
      // fatal here: retrying for a minute just hides the original crash header.
      await browser.executeObsidian(async ({ require, plugins }, word) => {
        const session = require('electron').remote.getCurrentWebContents().session;
        const result = await plugins.chillAutocorrect.nativeSpellchecker.check(word, session.getSpellCheckerLanguages());
        if (!result.misspelled || result.suggestions.length === 0) throw new Error('Native English spellchecker returned no suggestions for the test typo.');
      }, typo);
    } catch (error) {
      const diagnostics = await browser.executeObsidian(({ require, plugins }) => {
        const electron = require('electron');
        const session = electron.remote.getCurrentWebContents().session;
        const userData = electron.remote.app.getPath('userData');
        const dictionaries = require('path').join(userData, 'Dictionaries');
        return {
          languages: session.getSpellCheckerLanguages(), enabled: session.isSpellCheckerEnabled(),
          events: (window as unknown as { nativeSpellcheckEvents: string[] }).nativeSpellcheckEvents,
          dictionaryFiles: require('fs').existsSync(dictionaries) ? require('fs').readdirSync(dictionaries) : [],
          editorSpellcheck: document.querySelector('.cm-content')?.getAttribute('spellcheck'),
          text: document.querySelector('.cm-content')?.textContent,
          helper: plugins.chillAutocorrect.nativeSpellchecker.diagnostics(),
        };
      }).catch(() => ({ rendererDisconnected: true }));
      await fs.mkdir('artifacts', { recursive: true });
      await fs.writeFile('artifacts/native-spellcheck.json', JSON.stringify(diagnostics, null, 2));
      await browser.saveScreenshot('artifacts/native-spellcheck.png').catch(() => {});
      throw error;
    }
    suggestion = await browser.executeObsidian(async ({ require, plugins }, word) => {
      const languages = require('electron').remote.getCurrentWebContents().session.getSpellCheckerLanguages();
      return (await plugins.chillAutocorrect.nativeSpellchecker.check(word, languages)).suggestions[0];
    }, typo);
    expect(suggestion).not.toBe(typo);
  });

  beforeEach(async () => {
    await settings(DEFAULT_SETTINGS);
    await openText();
  });

  for (const source of [true, false]) {
    it(`uses the native first suggestion in ${source ? 'Source' : 'Live Preview'}`, async () => {
      await openText('', source);
      await browser.keys(typo);
      await browser.keys(' ');
      await expectText(`${suggestion} `);
      const position = await browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
        return editor.posToOffset(editor.getCursor());
      });
      expect(position).toBe(suggestion.length + 1);
    });
  }

  it('undoes only the correction with the platform shortcut', async () => {
    await browser.keys(typo); await browser.keys(' '); await expectText(`${suggestion} `);
    const mac = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMacOS);
    await browser.keys([mac ? 'Meta' : 'Control', 'z']);
    await expectText(`${typo} `);
  });

  it('restores with immediate Backspace and retains the trigger', async () => {
    await browser.keys(typo); await browser.keys(' '); await expectText(`${suggestion} `);
    await browser.keys('Backspace'); await expectText(`${typo} `);
    await browser.keys('Backspace'); await expectText(typo);
  });

  it('supports punctuation and Enter without removing their normal input', async () => {
    await settings({ space: false, enter: true, punctuation: ',' });
    await browser.keys(typo); await browser.keys(','); await expectText(`${suggestion},`);
    await openText(typo); await browser.keys('Enter'); await expectText(`${suggestion}\n`);
    await openText(typo); await browser.keys(' '); await expectText(`${typo} `);
  });

  it('supports Tab and preserves editor indentation', async () => {
    await settings({ enabled: false }); await openText(typo); await browser.keys('Tab');
    const baseline = await documentText();
    await settings({ enabled: true, tab: true });
    await openText(typo); await browser.keys('Tab');
    await expectText(baseline.replace(typo, suggestion));
  });

  for (const [label, prefix, suffix] of [
    ['inline code', '`', '`'], ['fenced code', '```text\n', '\n```'],
    ['frontmatter', '---\nname: ', '\n---'], ['wiki links', '[[', ']]'],
    ['tags', '#', ''], ['URLs', 'https://example.com/', ''],
    ['link destinations', '[label](https://example.com/', ')'],
    ['HTML', '<span>', '</span>'], ['math', '$', '$'],
  ]) {
    it(`leaves ${label} unchanged`, async () => {
      await openText(`${prefix}${typo}${suffix}`, true, prefix.length + typo.length);
      await browser.keys(' '); await expectText(`${prefix}${typo} ${suffix}`);
      // Wait beyond the asynchronous correction so an accidental change is observed.
      await browser.pause(200);
      expect(await documentText()).toBe(`${prefix}${typo} ${suffix}`);
    });
  }

  it('corrects ordinary link labels', async () => {
    await openText(`[${typo}](https://example.com)`, true, 1 + typo.length);
    await browser.keys(' '); await expectText(`[${suggestion} ](https://example.com)`);
  });

  it('persists settings and removes its handlers on unload', async () => {
    await settings({ punctuation: '!', space: false });
    await obsidianPage.disablePlugin(PLUGIN_ID);
    await openText(typo); await browser.keys(' '); await expectText(`${typo} `);
    await obsidianPage.enablePlugin(PLUGIN_ID);
    const saved = await browser.executeObsidian(({ plugins }) => plugins.chillAutocorrect.settings);
    expect(saved.space).toBe(false); expect(saved.punctuation).toBe('!');
    await openText(typo);
    await browser.execute(() => {
      (window as unknown as { lastDiagnosticKey: unknown }).lastDiagnosticKey = null;
      document.addEventListener('keydown', event => {
        (window as unknown as { lastDiagnosticKey: unknown }).lastDiagnosticKey = { key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey };
      }, { capture: true, once: true });
    });
    await browser.keys('!');
    try { await expectText(`${suggestion}!`); }
    catch (error) {
      console.log('Reload diagnostics:', await browser.executeObsidian(({ plugins, app, obsidian }) => ({
        settings: plugins.chillAutocorrect.settings, active: plugins.chillAutocorrect.runtime.active,
        status: (plugins.chillAutocorrect as unknown as { statusText: string }).statusText,
        key: (window as unknown as { lastDiagnosticKey: unknown }).lastDiagnosticKey,
        text: app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue(),
      })));
      throw error;
    }
  });

  it('corrects in a pop-out window using that window’s bridge', async () => {
    const main = await browser.getWindowHandle();
    const previous = await browser.getWindowHandles();
    await browser.executeObsidian(async ({ app, obsidian }) => {
      const file = await app.vault.create('Popout.md', '');
      if (!(file instanceof obsidian.TFile)) throw new Error('Missing test note');
      const leaf = app.workspace.getLeaf('window');
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > previous.length, { timeout: 15000 });
    const popout = (await browser.getWindowHandles()).find(handle => !previous.includes(handle))!;
    await browser.switchToWindow(popout);
    try {
      await browser.executeObsidian(({ app, obsidian }) => {
        app.workspace.iterateAllLeaves(leaf => {
          if (leaf.view instanceof obsidian.MarkdownView && leaf.view.containerEl.ownerDocument === document) {
            app.workspace.setActiveLeaf(leaf, { focus: true });
            leaf.view.editor.setValue(''); leaf.view.editor.focus();
          }
        });
      });
      await browser.keys(typo); await browser.keys(' '); await expectText(`${suggestion} `);
    } finally {
      await browser.closeWindow(); await browser.switchToWindow(main);
    }
  });

  // Last: changes to OS dictionaries can propagate between helper processes.
  // Avoid letting learn/unlearn activity influence reload and pop-out tests.
  it('respects additions and removals in the actual session dictionary', async () => {
    const fixture = await browser.executeObsidian(async ({ require, plugins }, candidates) => {
      const session = require('electron').remote.getCurrentWebContents().session;
      const languages = session.getSpellCheckerLanguages();
      const saved = new Set((await session.listWordsInSpellCheckerDictionary()).map((word: string) => word.normalize('NFC').toLowerCase()));
      const observations = [];
      for (const word of candidates) {
        if (saved.has(word.normalize('NFC').toLowerCase())) { observations.push({ word, saved: true }); continue; }
        const result = await plugins.chillAutocorrect.nativeSpellchecker.check(word, languages);
        observations.push({ word, ...result });
        const suggestion = result.suggestions[0];
        if (result.misspelled && typeof suggestion === 'string' && suggestion.length > 0 && suggestion !== word && !/[\r\n]/u.test(suggestion)) {
          return { selected: { word, suggestion }, observations };
        }
      }
      return { selected: null, observations };
    }, ['speling', 'recieve', 'definately', 'acommodate', 'occurence', 'mispeling', typo]);
    await fs.mkdir('artifacts/native', { recursive: true });
    await fs.writeFile('artifacts/native/dictionary-fixture.json', JSON.stringify(fixture, null, 2));
    if (!fixture.selected) throw new Error(`Native spellchecker provided no usable dictionary-test candidate: ${JSON.stringify(fixture.observations)}`);
    const { word, suggestion: beforeSuggestion } = fixture.selected;
    console.log(`Dictionary test fixture: ${word} -> ${beforeSuggestion}`);

    // Prove actual correction works before learning the test word. Absence of a
    // suggestion can never masquerade as successful dictionary protection.
    await openText(word); await browser.keys(' '); await expectText(`${beforeSuggestion} `);
    let added = false;
    try {
      added = await browser.executeObsidian(({ require }, word) => require('electron').remote.getCurrentWebContents().session.addWordToSpellCheckerDictionary(word) as boolean, word);
      expect(added).toBe(true);
      await browser.waitUntil(async () => browser.executeObsidian(async ({ require }, word) => {
        return (await require('electron').remote.getCurrentWebContents().session.listWordsInSpellCheckerDictionary()).includes(word);
      }, word), { timeout: 8000, timeoutMsg: 'Learned test word never appeared in the session dictionary' });
      await openText(word); await browser.keys(' '); await expectText(`${word} `);
      await browser.pause(200); expect(await documentText()).toBe(`${word} `);
    } finally {
      if (added) {
        const removed = await browser.executeObsidian(({ require }, word) => require('electron').remote.getCurrentWebContents().session.removeWordFromSpellCheckerDictionary(word), word);
        expect(removed).toBe(true);
      }
    }
    let afterSuggestion = '';
    await browser.waitUntil(async () => {
      const result = await browser.executeObsidian(async ({ require, plugins }, word) => {
        const session = require('electron').remote.getCurrentWebContents().session;
        if ((await session.listWordsInSpellCheckerDictionary()).includes(word)) return null;
        return plugins.chillAutocorrect.nativeSpellchecker.check(word, session.getSpellCheckerLanguages());
      }, word);
      const first = result?.suggestions[0];
      if (!result?.misspelled || typeof first !== 'string' || !first || first === word || /[\r\n]/u.test(first)) return false;
      afterSuggestion = first;
      return true;
    }, { timeout: 10000, timeoutMsg: 'Removed word did not become correctable again' });
    // OS learn/unlearn may reorder suggestions; use the current first result.
    await openText(word); await browser.keys(' '); await expectText(`${afterSuggestion} `);
  });
});
