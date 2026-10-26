import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { helperCommand, NativeSpellchecker } from '../../src/native-spellchecker';

interface Result { name: string; passed: boolean; error?: string; diagnostics?: unknown }
const results: Result[] = [];
const supported = process.platform === 'darwin' || process.platform === 'win32';

afterAll(async () => {
  await fs.mkdir('artifacts/native', { recursive: true });
  await fs.writeFile('artifacts/native/helper-results.json', JSON.stringify({
    platform: process.platform, arch: process.arch, os: os.release(), node: process.version, results,
  }, null, 2));
  const report = `# Direct native helper tests\n\nPlatform: ${process.platform} ${process.arch}; OS ${os.release()}; Node ${process.version}.\n\n` +
    results.map(result => `- ${result.passed ? 'PASS' : 'FAIL'}: ${result.name}${result.error ? ` — ${result.error}` : ''}`).join('\n') +
    '\n\nSee helper-results.json and macos-probes.json for the complete stage traces and crash headers. These tests run without Electron or Obsidian.\n';
  await fs.writeFile('artifacts/native/REPORT.md', report);
  console.log(report);
});

async function scenario(name: string, action: (client: NativeSpellchecker) => Promise<void>) {
  const client = new NativeSpellchecker();
  try {
    await action(client);
    results.push({ name, passed: true, diagnostics: client.diagnostics() });
  } catch (error) {
    results.push({ name, passed: false, error: String(error), diagnostics: client.diagnostics() });
    throw error;
  } finally { client.stop(); }
}

describe.skipIf(!supported)('real OS spellchecker without Obsidian', () => {
  it('starts, recognizes a correct word, and supplies ordered typo suggestions', async () => scenario('startup and native API', async client => {
    await client.start();
    expect(await client.check('hello', ['en-US'])).toEqual({ misspelled: false, suggestions: [] });
    const result = await client.check('typograpy', ['en-US']);
    expect(result.misspelled).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]).not.toBe('typograpy');
  }));

  it('survives repeated requests and Unicode on the same helper process', async () => scenario('repeated requests and Unicode lifetime', async client => {
    const words = ['typograpy', 'hello', 'café', 'naïve', 'e\u0301lan', '世界', '😀'];
    for (let index = 0; index < 70; index++) {
      const result = await client.check(words[index % words.length], ['en-US']);
      expect(typeof result.misspelled).toBe('boolean');
      expect(result.suggestions.every(word => typeof word === 'string')).toBe(true);
    }
    expect((await client.check('typograpy', ['en-US'])).suggestions.length).toBeGreaterThan(0);
  }));

  it('handles a UTF-8 character split across writes, batched lines and graceful EOF', async () => {
    const command = helperCommand(process.platform);
    const child = spawn(command.executable, command.args, { windowsHide: true, stdio: 'pipe' });
    let stdout = ''; let stderr = ''; let buffer = '';
    const messages: { id?: number; ready?: boolean; misspelled?: boolean; suggestions?: string[]; error?: string }[] = [];
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Attach immediately so a startup failure cannot create an unhandled rejection.
    void ready.catch(() => {});
    const complete = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Raw helper protocol timed out')); }, 20000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => { stderr += data; });
      child.stdout.on('data', (data: string) => {
        stdout += data; buffer += data;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line); messages.push(message);
            if (message.ready) readyResolve();
            if (typeof message.error === 'string') {
              const error = new Error(`Native request ${message.id ?? 'unknown'} failed: ${message.error}`);
              readyReject(error); reject(error); child.kill();
            }
          } catch { reject(new Error(`Invalid helper output: ${line}`)); child.kill(); }
        }
      });
      child.on('error', error => { clearTimeout(timer); readyReject(error); reject(error); });
      child.stdin.on('error', error => { clearTimeout(timer); readyReject(error); reject(error); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0 && !signal) resolve();
        else { const error = new Error(`Helper code=${code} signal=${signal}\n${stderr}`); readyReject(error); reject(error); }
      });
    });
    void complete.catch(() => {});
    let failure: unknown;
    try {
      await Promise.race([ready, complete.then(() => { throw new Error('Helper exited before ready'); })]);
      const first = Buffer.from(JSON.stringify({ id: 1, word: 'café', languages: ['en-US'] }) + '\n');
      const split = first.indexOf(Buffer.from('é')) + 1;
      child.stdin.write(first.subarray(0, split));
      await new Promise(resolve => setTimeout(resolve, 20));
      child.stdin.write(first.subarray(split));
      child.stdin.end([2, 3].map(id => JSON.stringify({ id, word: id === 2 ? 'hello' : 'typograpy', languages: ['en-US'] })).join('\n') + '\n');
      await complete;
      expect(messages.filter(message => message.id).map(message => message.id)).toEqual([1, 2, 3]);
      expect(messages.find(message => message.id === 2)?.misspelled).toBe(false);
      expect(messages.find(message => message.id === 3)?.suggestions?.length).toBeGreaterThan(0);
    } catch (error) { failure = error; throw error; }
    finally {
      child.kill();
      results.push({ name: 'split UTF-8 / batched lines / EOF', passed: !failure, error: failure ? String(failure) : undefined, diagnostics: { stdout, stderr } });
    }
  });
});
