import path from 'node:path';
import fs from 'node:fs/promises';

export const config: WebdriverIO.Config = {
  runner: 'local', framework: 'mocha', specs: ['./test/e2e/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [{
    browserName: 'obsidian', browserVersion: '1.14.4',
    'wdio:obsidianOptions': {
      installerVersion: 'latest', plugins: ['.'], vault: 'test/vault', copy: true,
      ...(process.env.OBSIDIAN_BINARY ? { binaryPath: process.env.OBSIDIAN_BINARY } : {}),
      ...(process.env.OBSIDIAN_APP ? { appPath: process.env.OBSIDIAN_APP } : {}),
    },
  }],
  services: ['obsidian'], reporters: ['obsidian'],
  cacheDir: path.resolve('.obsidian-cache'),
  outputDir: path.resolve('artifacts/logs'),
  logLevel: 'warn',
  connectionRetryCount: 1,
  mochaOpts: { ui: 'bdd', timeout: 90000 },
  afterTest: async function (test, _context, { passed }) {
    if (passed) return;
    await fs.mkdir('artifacts/screenshots', { recursive: true });
    const { browser } = await import('@wdio/globals');
    await browser.saveScreenshot(`artifacts/screenshots/${test.title.replace(/[^a-z0-9]/gi, '_')}.png`);
  },
};
