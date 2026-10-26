import type AutoCorrectPlugin from '../src/main';
declare module 'wdio-obsidian-service' {
  interface InstalledPlugins { chillAutocorrect: AutoCorrectPlugin }
}
