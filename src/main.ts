import { Plugin, PluginSettingTab, Setting } from 'obsidian';
import { autoCorrectExtension, type Runtime } from './extension';
import { DEFAULT_SETTINGS, loadSettings, normalizePunctuation, type Settings } from './settings';

export default class AutoCorrectPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  runtime!: Runtime;
  private statusText = 'Native spellcheck will be checked on the next trigger.';
  private statusEl?: HTMLElement;

  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.runtime = {
      settings: this.settings, generation: 0, active: true,
      status: message => { this.statusText = message; if (this.statusEl) this.statusEl.textContent = message; },
    };
    this.registerEditorExtension(autoCorrectExtension(this.runtime));
    this.addSettingTab(new AutoCorrectSettings(this));
  }

  onunload() { this.runtime.active = false; this.runtime.generation++; this.statusEl = undefined; }

  async updateSettings(patch: Partial<Settings>) {
    this.settings = loadSettings({ ...this.settings, ...patch });
    this.runtime.settings = this.settings;
    this.runtime.generation++;
    await this.saveData(this.settings);
  }

  renderSettings(container: HTMLElement) {
    container.empty();
    new Setting(container).setName('Auto Correct').setHeading();
    container.createEl('p', { text: 'Correct the completed word using the first native suggestion. Words in your Obsidian dictionary are preserved. Undo reverses a correction; immediate Backspace restores the word and keeps the trigger.' });
    this.statusEl = container.createEl('p', { text: this.statusText, attr: { role: 'status' } });
    for (const [key, label] of [['enabled', 'Enable autocorrect'], ['space', 'Space'], ['enter', 'Enter'], ['tab', 'Tab']] as const) {
      new Setting(container).setName(label).addToggle(toggle => toggle.setValue(this.settings[key]).onChange(value => this.updateSettings({ [key]: value })));
    }
    new Setting(container).setName('Punctuation triggers').setDesc('Each punctuation character is a trigger, for example . , ; : ! ? Apostrophes and underscores are excluded.').addText(text => text
      .setPlaceholder('.,;:!?').setValue(this.settings.punctuation)
      .onChange(value => this.updateSettings({ punctuation: normalizePunctuation(value) })));
    container.createEl('p', { text: 'Uses your existing Obsidian spelling languages. On macOS, language detection is managed by the operating system. Code, metadata, links and other non-prose syntax are excluded.' });
  }
}

class AutoCorrectSettings extends PluginSettingTab {
  constructor(private readonly plugin: AutoCorrectPlugin) { super(plugin.app, plugin); }
  display() { this.plugin.renderSettings(this.containerEl); }
}
