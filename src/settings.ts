export interface Settings {
  enabled: boolean;
  space: boolean;
  enter: boolean;
  tab: boolean;
  punctuation: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true, space: true, enter: false, tab: false, punctuation: '',
};

export function loadSettings(data: unknown): Settings {
  const value = data && typeof data === 'object' ? data as Partial<Settings> : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of ['enabled', 'space', 'enter', 'tab'] as const) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  settings.punctuation = normalizePunctuation(value.punctuation);
  return settings;
}

export function normalizePunctuation(value: unknown): string {
  return typeof value === 'string' ? [...new Set([...value].filter(c => /\p{P}/u.test(c) && !/['’_]/u.test(c)))].join('') : '';
}

export function isTrigger(key: string, settings: Settings): boolean {
  return settings.enabled && (
    (key === ' ' && settings.space) || (key === 'Enter' && settings.enter) ||
    (key === 'Tab' && settings.tab) || ([...key].length === 1 && settings.punctuation.includes(key))
  );
}
