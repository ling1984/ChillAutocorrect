import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { DEFAULT_SETTINGS, type Settings } from '../../src/settings';
import fs from 'node:fs/promises';

const typo = 'typograpy';
let suggestion: string;

async function settings(patch: Partial<Settings>) {
  await browser.executeObsidian(async ({ plugins }, value) => plugins.autoCorrect.updateSettings(value), patch);
}

async function documentText() {
  return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue());
}

async function openText(text = '', source = true, cursor?: number) {
  await browser.executeObsidian(async ({ app, obsidian }, text, source, cursor) => {
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'markdown', state: { file: 'Test.md', mode: 'source', source } });
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
      await browser.waitUntil(async () => browser.executeObsidian(({ require }, word) => {
        const electron = require('electron');
        return electron.webFrame.isWordMisspelled(word) && electron.webFrame.getWordSuggestions(word).length > 0;
      }, typo), { timeout: 60000, interval: 500, timeoutMsg: 'Native English spellchecker did not become ready' });
    } catch (error) {
      const diagnostics = await browser.executeObsidian(({ require }) => {
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
        };
      }).catch(() => ({ rendererDisconnected: true }));
      await fs.mkdir('artifacts', { recursive: true });
      await fs.writeFile('artifacts/native-spellcheck.json', JSON.stringify(diagnostics, null, 2));
      await browser.saveScreenshot('artifacts/native-spellcheck.png').catch(() => {});
      throw error;
    }
    suggestion = await browser.executeObsidian(({ require }, word) => require('electron').webFrame.getWordSuggestions(word)[0] as string, typo);
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
    await settings({ tab: true }); await openText(typo); await browser.keys('Tab');
    await browser.waitUntil(async () => (await documentText()).startsWith(suggestion), { timeout: 8000 });
    expect((await documentText()).slice(suggestion.length)).toMatch(/^[\t ]+$/u);
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

  it('respects additions and removals in the actual session dictionary', async () => {
    const alreadySaved = await browser.executeObsidian(async ({ require }, word) => {
      const session = require('electron').remote.getCurrentWebContents().session;
      return (await session.listWordsInSpellCheckerDictionary()).includes(word);
    }, typo);
    expect(alreadySaved).toBe(false);
    try {
      const added = await browser.executeObsidian(({ require }, word) => require('electron').remote.getCurrentWebContents().session.addWordToSpellCheckerDictionary(word), typo);
      expect(added).toBe(true);
      await openText(typo); await browser.keys(' '); await expectText(`${typo} `);
      await browser.pause(200); expect(await documentText()).toBe(`${typo} `);
    } finally {
      if (!alreadySaved) await browser.executeObsidian(({ require }, word) => require('electron').remote.getCurrentWebContents().session.removeWordFromSpellCheckerDictionary(word), typo);
    }
    await browser.waitUntil(async () => browser.executeObsidian(({ require }, word) => require('electron').webFrame.isWordMisspelled(word), typo), { timeout: 8000 });
    await openText(typo); await browser.keys(' '); await expectText(`${suggestion} `);
  });

  it('persists settings and removes its handlers on unload', async () => {
    await settings({ punctuation: '!', space: false });
    await obsidianPage.disablePlugin('auto-correct');
    await openText(typo); await browser.keys(' '); await expectText(`${typo} `);
    await obsidianPage.enablePlugin('auto-correct');
    const saved = await browser.executeObsidian(({ plugins }) => plugins.autoCorrect.settings);
    expect(saved.space).toBe(false); expect(saved.punctuation).toBe('!');
    await openText(typo); await browser.keys('!'); await expectText(`${suggestion}!`);
  });

  it('corrects in a pop-out window using that window’s bridge', async () => {
    const main = await browser.getWindowHandle();
    const previous = await browser.getWindowHandles();
    await browser.executeObsidian(async ({ app, obsidian }) => {
      const file = app.vault.getAbstractFileByPath('Test.md');
      if (!(file instanceof obsidian.TFile)) throw new Error('Missing test note');
      await app.workspace.getLeaf('window').openFile(file);
    });
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > previous.length, { timeout: 15000 });
    const popout = (await browser.getWindowHandles()).find(handle => !previous.includes(handle))!;
    await browser.switchToWindow(popout);
    try {
      await browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
        editor.setValue(''); editor.focus();
      });
      await browser.keys(typo); await browser.keys(' '); await expectText(`${suggestion} `);
    } finally {
      await browser.closeWindow(); await browser.switchToWindow(main);
    }
  });
});
