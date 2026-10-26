// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { helperCommand, NativeSpellchecker } from '../../src/native-spellchecker';

function harness() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true; }),
  });
  const launch = vi.fn(() => child);
  const client = new NativeSpellchecker('win32', launch as unknown as typeof spawn);
  const requests: { id: number; word: string; languages: string[] }[] = [];
  child.stdin.on('data', data => requests.push(JSON.parse(data.toString())));
  const ready = () => child.stdout.write('{"ready":true}\n');
  const respond = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n');
  return { child, client, requests, launch, ready, respond };
}
afterEach(() => vi.useRealTimers());
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('native helper protocol', () => {
  it('keeps words out of executable scripts and arguments', () => {
    const command = helperCommand('win32');
    expect(command.executable.toLowerCase()).toContain('windowspowershell');
    expect(command.args).toContain('-EncodedCommand');
    expect(helperCommand('darwin').executable).toBe('/usr/bin/osascript');
    expect(() => helperCommand('linux')).toThrow('Windows and macOS');
  });
  it('reuses one hidden process and exchanges Unicode JSON', async () => {
    const h = harness();
    const first = h.client.check('naïve', ['fr']); h.ready(); await tick();
    expect(h.requests[0].word).toBe('naïve');
    expect(h.launch.mock.calls[0]).toEqual(expect.arrayContaining([expect.any(String), expect.any(Array), { windowsHide: true, stdio: 'pipe' }]));
    h.respond({ id: h.requests[0].id, misspelled: false, suggestions: [] });
    expect(await first).toEqual({ misspelled: false, suggestions: [] });
    const second = h.client.check('typo', ['en-US']); await tick();
    h.respond({ id: h.requests[1].id, misspelled: true, suggestions: ['first', 'second'] });
    expect((await second).suggestions).toEqual(['first', 'second']);
    expect(h.launch).toHaveBeenCalledTimes(1); h.client.stop();
  });
  it('rejects native language errors without inventing a correction', async () => {
    const h = harness(); const result = h.client.check('word', ['missing']); h.ready(); await tick();
    const assertion = expect(result).rejects.toThrow('language unavailable');
    h.respond({ id: h.requests[0].id, error: 'language unavailable' });
    await assertion; h.client.stop();
  });
  it('rejects in-flight requests on unload and does not restart', async () => {
    const h = harness(); const result = h.client.check('word', ['en']); h.ready(); await tick();
    const assertion = expect(result).rejects.toThrow('closed');
    h.client.stop(); await assertion;
    await expect(h.client.check('word', ['en'])).rejects.toThrow('closed');
  });
  it('rejects malformed native results', async () => {
    const h = harness(); const result = h.client.check('word', ['en']); h.ready(); await tick();
    const assertion = expect(result).rejects.toThrow('Invalid response');
    h.respond({ id: h.requests[0].id, misspelled: true, suggestions: [42] });
    await assertion; h.client.stop();
  });
  it('times out and terminates a stuck native request', async () => {
    vi.useFakeTimers();
    const h = harness(); const result = h.client.check('word', ['en']); h.ready();
    await vi.advanceTimersByTimeAsync(0);
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(3000);
    await assertion; expect(h.child.kill).toHaveBeenCalled();
    h.client.stop();
  });
});
