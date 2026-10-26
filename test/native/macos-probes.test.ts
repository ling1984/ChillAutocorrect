import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const output: unknown[] = [];
const prefix = `function stage(s) { console.log('AUTO_CORRECT_STAGE:' + s); }
stage('foundation.import'); ObjC.import('Foundation');`;
const appkit = `${prefix}
stage('appkit.import'); ObjC.import('AppKit');
stage('spellchecker.create'); const checker = $.NSSpellChecker.sharedSpellChecker;
const tag = $.NSSpellChecker.uniqueSpellDocumentTag;
checker.automaticallyIdentifiesLanguages = true; stage('spellchecker.ready');`;

afterAll(async () => {
  if (process.platform !== 'darwin') return;
  await fs.mkdir('artifacts/native', { recursive: true });
  await fs.writeFile('artifacts/native/macos-probes.json', JSON.stringify(output, null, 2));
});

async function probe(name: string, script: string, informational = false) {
  try {
    const result = await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 15000, maxBuffer: 1024 * 1024 });
    output.push({ name, informational, passed: true, ...result });
    console.log(`MAC PROBE ${name}: passed\n${result.stderr}`);
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number; signal?: string };
    output.push({ name, informational, passed: false, error: failure.message, stdout: failure.stdout, stderr: failure.stderr, code: failure.code, signal: failure.signal });
    console.log(`MAC PROBE ${name}: failed\n${failure.stderr ?? failure.message}`);
    if (!informational) throw error;
  }
}

describe.skipIf(process.platform !== 'darwin')('isolated macOS Objective-C bridge probes', () => {
  it('imports Foundation and round-trips complete Unicode data', async () => {
    const result = await probe('foundation-unicode', `${prefix}
stage('unicode.encode'); const data = $('café 世界').dataUsingEncoding($.NSUTF8StringEncoding);
stage('unicode.decode'); const value = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
JSON.stringify({value:value});`);
    expect(result.value).toBe('café 世界');
  });
  it('creates the AppKit spellchecker independently of stdin and Electron', async () => {
    const result = await probe('appkit-startup', `${appkit}
JSON.stringify({ready:true});`);
    expect(result.ready).toBe(true);
  });
  it('checks NSRange and suggestion bridging without any manual pool', async () => {
    const result = await probe('native-selectors', `${appkit}
stage('spelling.check'); const range = checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount($('typograpy'), 0, null, false, tag, null);
stage('spelling.suggest'); const guesses = checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(range, $('typograpy'), null, tag);
stage('suggestions.unwrap'); JSON.stringify({length:range.length, guesses:ObjC.deepUnwrap(guesses)});`);
    expect(result.length).toBeGreaterThan(0);
    expect(result.guesses.length).toBeGreaterThan(0);
  });
  it('records the old manual-pool pattern in a disposable subprocess', async () => {
    // Informational control: OS/JXA versions differ; a crash here must not
    // prevent the corrected helper and isolated stages from being tested.
    await probe('legacy-manual-pool-control', `${appkit}
for (let i=0; i<3; i++) {
  stage('legacy.pool.create'); const pool = $.NSAutoreleasePool.alloc.init;
  stage('legacy.spelling.check'); const range = checker.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount($('typograpy'), 0, null, false, tag, null);
  stage('legacy.spelling.suggest'); const guesses = checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(range, $('typograpy'), null, tag);
  ObjC.deepUnwrap(guesses); stage('legacy.pool.drain'); pool.drain;
}
stage('legacy.complete'); JSON.stringify({completed:true});`, true);
  });
});
