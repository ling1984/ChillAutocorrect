import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { MACOS_HELPER, WINDOWS_HELPER } from './native-scripts';

export interface NativeResult { misspelled: boolean; suggestions: string[] }
export interface NativeChecker { check(word: string, languages: string[]): Promise<NativeResult> }

export function helperCommand(platform: string) {
  if (platform === 'win32') return {
    executable: path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_HELPER, 'utf16le').toString('base64')],
  };
  if (platform === 'darwin') return { executable: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MACOS_HELPER] };
  throw new Error('Native autocorrect supports Windows and macOS.');
}

export class NativeSpellchecker implements NativeChecker {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private closed = false;
  private id = 0;
  private requests = new Map<number, { resolve(value: NativeResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly platform = process.platform, private readonly launch: typeof spawn = spawn) {}

  async start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Native spellchecker is closed.'));
    if (this.ready) return this.ready;
    const { executable, args } = helperCommand(this.platform);
    const child = this.launch(executable, args, { windowsHide: true, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      let buffer = '';
      let stderr = '';
      const startupTimer = setTimeout(() => fail(new Error('Native spellchecker startup timed out.')), 15000);
      const fail = (error: Error) => {
        clearTimeout(startupTimer);
        reject(error);
        if (this.child !== child) return;
        this.child = undefined;
        this.ready = undefined;
        for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
        this.requests.clear();
        child.kill();
      };
      child.on('error', error => fail(new Error(`Could not start native spellchecker: ${error.message}`)));
      child.on('exit', () => fail(new Error(`Native spellchecker exited.${stderr ? ` ${stderr.trim().slice(0, 400)}` : ''}`)));
      child.stdin.on('error', error => fail(error));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => { stderr = (stderr + data).slice(-2000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) { fail(new Error('Native spellchecker response too large.')); return; }
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const value = JSON.parse(line);
            if (value.ready === true) { clearTimeout(startupTimer); resolve(); continue; }
            const request = this.requests.get(value.id);
            if (!request) continue;
            this.requests.delete(value.id); clearTimeout(request.timer);
            if (typeof value.error === 'string') request.reject(new Error(value.error));
            else if (typeof value.misspelled !== 'boolean' || !Array.isArray(value.suggestions) || value.suggestions.some((s: unknown) => typeof s !== 'string')) {
              request.reject(new Error('Invalid response from native spellchecker.'));
            } else request.resolve({ misspelled: value.misspelled, suggestions: value.suggestions });
          } catch { fail(new Error('Invalid JSON from native spellchecker.')); return; }
        }
      });
    });
    return this.ready;
  }

  async check(word: string, languages: string[]): Promise<NativeResult> {
    await this.start();
    if (!this.child || this.closed) throw new Error('Native spellchecker is unavailable.');
    const child = this.child;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('Native spellcheck request timed out.'));
        // A stuck helper must not block every future request.
        if (this.child === child) child.kill();
      }, 3000);
      this.requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, word, languages }) + '\n');
    });
  }

  stop() {
    this.closed = true;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new Error('Native spellchecker closed.')); }
    this.requests.clear();
    this.child?.kill();
  }
}
