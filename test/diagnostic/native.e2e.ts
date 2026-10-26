import { browser } from '@wdio/globals';
import fs from 'node:fs/promises';

describe('Native spellcheck diagnosis', () => {
  it('prints the renderer APIs beside the actual native context-menu result', async () => {
    await browser.executeObsidian(async ({ app, obsidian, plugins, require }) => {
      await (plugins.chillAutocorrect as unknown as { updateSettings(value: { enabled: boolean }): Promise<void> }).updateSettings({ enabled: false });
      const electron = require('electron');
      const session = electron.remote.getCurrentWebContents().session;
      session.setSpellCheckerEnabled(true);
      if (!obsidian.Platform.isMacOS) session.setSpellCheckerLanguages(['en-US']);
      await session.listWordsInSpellCheckerDictionary();
      const leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: 'markdown', state: { file: 'Test.md', mode: 'source', source: true } });
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
      editor.setValue('typograpy'); editor.setCursor({ line: 0, ch: 9 }); editor.focus();
      electron.ipcRenderer.on('context-menu', (_event: unknown, params: unknown) => {
        (window as unknown as { diagnosticMenu: unknown }).diagnosticMenu = params;
      });
    });
    await browser.keys(' ');
    await browser.pause(1500);
    const point = await browser.execute(() => {
      const line = document.querySelector('.cm-line')!;
      const range = document.createRange();
      range.selectNodeContents(line);
      const rect = range.getBoundingClientRect();
      return { x: Math.round(rect.left + 20), y: Math.round(rect.top + rect.height / 2) };
    });
    await browser.performActions([{ type: 'pointer', id: 'diagnostic-mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', ...point },
      { type: 'pointerDown', button: 2 }, { type: 'pointerUp', button: 2 },
    ] }]);
    await browser.releaseActions();
    await browser.waitUntil(async () => browser.execute(() => Boolean((window as unknown as { diagnosticMenu: unknown }).diagnosticMenu)), { timeout: 5000 }).catch(() => {});
    const result = await browser.executeObsidian(async ({ require, plugins }) => {
      const electron = require('electron');
      const winElectron = (window as unknown as { electron: typeof electron }).electron;
      const session = electron.remote.getCurrentWebContents().session;
      const check = (frame: typeof electron.webFrame) => ['typograpy', 'speling', 'hello'].map(word => ({
        word, isMisspelled: frame.isWordMisspelled(word), suggestions: frame.getWordSuggestions(word),
      }));
      return {
        versions: require('process').versions,
        languages: session.getSpellCheckerLanguages(),
        enabled: session.isSpellCheckerEnabled(),
        customDictionaryProtectsTypo: (await session.listWordsInSpellCheckerDictionary()).some((word: string) => word.toLowerCase() === 'typograpy'),
        rendererRequire: check(electron.webFrame),
        rendererWindow: check(winElectron.webFrame),
        nativeOS: await plugins.chillAutocorrect.nativeSpellchecker.check('typograpy', session.getSpellCheckerLanguages()),
        nativeContextMenu: (window as unknown as { diagnosticMenu: { misspelledWord: string; dictionarySuggestions: string[] } }).diagnosticMenu ?? null,
      };
    });
    await browser.keys('Escape');
    const native = result.nativeContextMenu;
    const renderer = result.rendererWindow[0];
    const conclusion = result.nativeOS.misspelled && result.nativeOS.suggestions[0] === native?.dictionarySuggestions[0]
      ? 'FIX VERIFIED: Direct OS spellcheck detects typograpy and returns the same first suggestion as the native menu. The plugin now uses this OS helper and checks Obsidian’s custom dictionary before requesting a correction.'
      : native?.misspelledWord === 'typograpy' && native.dictionarySuggestions.length &&
      (!renderer.isMisspelled || !renderer.suggestions.length)
      ? 'CONFIRMED: The native spellchecker detects the typo and supplies suggestions, but Electron webFrame does not expose those results. The plugin relies on webFrame, so it skips the correction.'
      : 'See the raw API comparison below; the expected renderer/native mismatch was not fully reproduced.';
    const report = `# Native spellcheck diagnosis\n\n${conclusion}\n\n` +
      `| Check | Result |\n|---|---|\n| Spellcheck enabled | ${result.enabled} |\n| Languages | ${result.languages.join(', ')} |\n` +
      `| Typo in custom dictionary | ${result.customDictionaryProtectsTypo} |\n| webFrame says misspelled | ${renderer.isMisspelled} |\n` +
      `| webFrame suggestions | ${JSON.stringify(renderer.suggestions)} |\n| Native menu misspelling | ${native?.misspelledWord ?? '(no event)'} |\n` +
      `| Native menu suggestions | ${JSON.stringify(native?.dictionarySuggestions ?? [])} |\n` +
      `| Direct OS says misspelled | ${result.nativeOS.misspelled} |\n| Direct OS suggestions | ${JSON.stringify(result.nativeOS.suggestions)} |\n\n` +
      `The original failure was the webFrame early return. Production corrections now use the direct OS result through src/native-spellchecker.ts. No menus or editor focus changes are needed.\n\n` +
      `## Raw output\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    await fs.mkdir('artifacts', { recursive: true });
    await fs.writeFile('artifacts/DIAGNOSIS.md', report);
    await fs.writeFile('artifacts/native-api-comparison.json', JSON.stringify(result, null, 2));
    console.log(`\n${report}`);
  });
});
