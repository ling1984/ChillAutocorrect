import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { id: string };
export const PLUGIN_ID = manifest.id;
// This is the same ID-to-key conversion used by WDIO's helper plugin.
export const PLUGIN_KEY = PLUGIN_ID.replace(/-\w/g, match => match[1].toUpperCase());
