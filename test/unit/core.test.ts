import { describe, expect, it } from 'vitest';
import { precedingWord } from '../../src/words';
import { DEFAULT_SETTINGS, isTrigger, loadSettings, normalizePunctuation } from '../../src/settings';
import { electronSpellchecker, firstCorrection, type Spellchecker } from '../../src/spellcheck';

describe('completed words', () => {
  it.each(['hello', 'café', 'naïve', '世界', "don't", 'l’esprit', 'e\u0301lan'])('extracts %s', word => {
    expect(precedingWord(`A ${word}`, word.length + 2)).toEqual({ from: 2, to: word.length + 2, text: word });
  });
  it.each(['foo1', '1foo', 'foo_bar', "'hello", "hello'", 'foo’', '', ' '])('skips %s', word => {
    expect(precedingWord(word, word.length)).toBeNull();
  });
  it('does not correct the prefix of a word', () => expect(precedingWord('hello', 3)).toBeNull());
});

describe('settings', () => {
  it('uses safe defaults for invalid saved data', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ enabled: 'yes', space: false, unknown: true })).toEqual({ ...DEFAULT_SETTINGS, space: false });
  });
  it('normalizes punctuation and excludes word characters', () => {
    expect(normalizePunctuation("..,! abc_’'\n")).toBe('.,!');
  });
  it('selects only configured triggers', () => {
    expect(isTrigger(' ', DEFAULT_SETTINGS)).toBe(true);
    expect(isTrigger('Enter', DEFAULT_SETTINGS)).toBe(false);
    expect(isTrigger('Tab', { ...DEFAULT_SETTINGS, tab: true })).toBe(true);
    expect(isTrigger('.', { ...DEFAULT_SETTINGS, punctuation: '.' })).toBe(true);
    expect(isTrigger(' ', { ...DEFAULT_SETTINGS, enabled: false })).toBe(false);
  });
});

const checker = (overrides: Partial<Spellchecker> = {}): Spellchecker => ({
  isMisspelled: () => true, suggestions: () => ['first', 'second'], dictionary: async () => [], ...overrides,
});

describe('native suggestions', () => {
  it('selects exactly the first suggestion', async () => expect(await firstCorrection('typo', checker())).toBe('first'));
  it('preserves case variants and canonical Unicode dictionary entries', async () => {
    expect(await firstCorrection('Typo', checker({ dictionary: async () => ['TYPO'] }))).toBeNull();
    expect(await firstCorrection('é', checker({ dictionary: async () => ['e\u0301'] }))).toBeNull();
  });
  it('leaves correct words and words without suggestions alone', async () => {
    expect(await firstCorrection('correct', checker({ isMisspelled: () => false }))).toBeNull();
    expect(await firstCorrection('typo', checker({ suggestions: () => [] }))).toBeNull();
  });
  it('propagates dictionary failures instead of correcting unprotected words', async () => {
    await expect(firstCorrection('typo', checker({ dictionary: async () => { throw new Error('offline'); } }))).rejects.toThrow('offline');
  });
  it('rejects unavailable Electron bridges', () => expect(() => electronSpellchecker(window)).toThrow('unavailable'));
  it('uses the supplied window bridge and session dictionary', async () => {
    const win = { electron: { webFrame: { isWordMisspelled: () => true, getWordSuggestions: () => ['right'] }, remote: {
      getCurrentWebContents: () => ({ session: { listWordsInSpellCheckerDictionary: async () => ['saved'] } }),
    } } } as unknown as Window;
    expect(await firstCorrection('wrong', electronSpellchecker(win))).toBe('right');
    expect(await firstCorrection('Saved', electronSpellchecker(win))).toBeNull();
  });
});
