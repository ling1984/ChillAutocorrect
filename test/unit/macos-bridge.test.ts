// @vitest-environment node
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MACOS_SPELLING } from '../../src/native-scripts';

// Model the bridge contract from the Mac failure: JS null is an NSNull object,
// whereas $() is Objective-C nil. Execute the exact production spelling function.
function bridgeHarness(correct = false, noGuesses = false) {
  const nil = Symbol('Objective-C nil');
  const pointer = { value: 0 };
  const languages: unknown[] = [];
  const context = vm.createContext({
    $: (...args: unknown[]) => args.length === 0 ? nil : args[0],
    Ref: () => pointer,
    stage: () => {}, tag: 1, ObjC: { deepUnwrap: (value: unknown) => value },
    checker: {
      checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount: (_text: string, _start: number, language: unknown, _wrap: boolean, _tag: number, wordCount: unknown) => {
        if (language !== nil) throw new Error('-[NSNull isEqualToString:]');
        if (wordCount !== pointer) throw new Error('wordCount requires an output pointer');
        languages.push(language);
        return { location: 0, length: correct ? 0 : 9 };
      },
      guessesForWordRangeInStringLanguageInSpellDocumentWithTag: (_range: unknown, _text: string, language: unknown) => {
        if (language !== nil) throw new Error('-[NSNull isEqualToString:]');
        languages.push(language);
        return noGuesses ? undefined : ['typography', 'typograph'];
      },
    },
  });
  vm.runInContext(MACOS_SPELLING, context);
  return { context, languages };
}

describe('JXA native argument contract', () => {
  it('passes Objective-C nil and a real output reference to both spelling APIs', () => {
    const { context, languages } = bridgeHarness();
    const result = vm.runInContext("checkNativeWord('typograpy')", context);
    expect(result).toEqual({ misspelled: true, suggestions: ['typography', 'typograph'] });
    expect(languages).toHaveLength(2);
  });
  it('leaves correct words unchanged without asking for suggestions', () => {
    const { context, languages } = bridgeHarness(true);
    expect(vm.runInContext("checkNativeWord('hello')", context)).toEqual({ misspelled: false, suggestions: [] });
    expect(languages).toHaveLength(1);
  });
  it('normalizes a nil suggestion array to an empty array', () => {
    const { context } = bridgeHarness(false, true);
    expect(vm.runInContext("checkNativeWord('typograpy')", context)).toEqual({ misspelled: true, suggestions: [] });
  });
  it('reproduces the reported NSNull failure with the previous JS-null argument', () => {
    const { context } = bridgeHarness();
    expect(() => vm.runInContext("checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount('typograpy',0,null,false,tag,Ref())", context)).toThrow('NSNull');
  });
});
