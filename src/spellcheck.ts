export interface Spellchecker {
  isMisspelled(word: string): boolean;
  suggestions(word: string): string[];
  dictionary(): Promise<string[]>;
}

interface ElectronBridge {
  webFrame?: { isWordMisspelled?: (word: string) => boolean; getWordSuggestions?: (word: string) => string[] };
  remote?: { getCurrentWebContents?: () => { session?: { listWordsInSpellCheckerDictionary?: () => Promise<string[]> } } };
}

export function electronSpellchecker(win: Window): Spellchecker {
  const host = win as Window & { electron?: ElectronBridge; require?: (name: string) => ElectronBridge };
  const electron = host.electron ?? host.require?.('electron');
  const frame = electron?.webFrame;
  const session = electron?.remote?.getCurrentWebContents?.().session;
  if (!frame?.isWordMisspelled || !frame.getWordSuggestions || !session?.listWordsInSpellCheckerDictionary) {
    throw new Error('Native spellcheck or custom dictionary API is unavailable.');
  }
  return {
    isMisspelled: word => frame.isWordMisspelled!(word),
    suggestions: word => frame.getWordSuggestions!(word),
    dictionary: () => session.listWordsInSpellCheckerDictionary!(),
  };
}

const canonical = (word: string) => word.normalize('NFC').toLowerCase();

export async function firstCorrection(word: string, checker: Spellchecker): Promise<string | null> {
  if (!checker.isMisspelled(word)) return null;
  const dictionary = await checker.dictionary();
  if (!Array.isArray(dictionary) || dictionary.some(entry => typeof entry !== 'string')) {
    throw new Error('Custom dictionary could not be read.');
  }
  if (dictionary.some(entry => canonical(entry) === canonical(word))) return null;
  const suggestion = checker.suggestions(word)[0];
  return typeof suggestion === 'string' && suggestion.length > 0 && suggestion !== word && !/[\r\n]/u.test(suggestion) ? suggestion : null;
}
