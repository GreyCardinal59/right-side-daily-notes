import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, moment } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

// Интерфейс для настроек системного плагина Daily Notes
interface DailyNotesSettings {
	folder?: string;
	format?: string;
	template?: string;
}

export default class DailyNotesInSidebarPlugin extends Plugin {
	private dailyNotesLeaf: WorkspaceLeaf | null = null;
	private lastActiveFile: TFile | null = null;
	private isProcessingDailyNote: boolean = false;
	settings: MyPluginSettings;
	private dailyNotesFormat: string | null = null;
	private dailyNotesFolder: string | null = null;

	async onload() {
		await this.loadSettings();
		
		// Загрузка настроек системного плагина Daily Notes
		await this.loadDailyNotesSettings();
		
		this.app.workspace.onLayoutReady(() => {
			this.ensureDailyNotesLeaf();
		});

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file) return;

				if (this.isDailyNote(file.path)) {
					if (this.isProcessingDailyNote) return;
					this.isProcessingDailyNote = true;
					
					this.openInRightLeaf(file).then(() => {
						this.restorePreviousFileInMainSplit(file);
						this.isProcessingDailyNote = false;
					});
				} else {
					const activeLeaf = this.app.workspace.activeLeaf;
					if (activeLeaf && !this.isLeafInRightSplit(activeLeaf)) {
						this.lastActiveFile = file;
					}
				}
			})
		);
	}

	private async loadDailyNotesSettings() {
		// Получаем настройки системного плагина Daily Notes
		try {
			// Пробуем прочитать файл daily-notes.json напрямую
			try {
				const dailyNotesSettings = await this.app.vault.adapter.read(
					`${this.app.vault.configDir}/daily-notes.json`
				);
				
				const settings = JSON.parse(dailyNotesSettings) as DailyNotesSettings;
				this.dailyNotesFormat = settings.format || 'YYYY-MM-DD';
				this.dailyNotesFolder = settings.folder || '';
				
				console.log('Daily Notes settings loaded from file:', this.dailyNotesFormat, this.dailyNotesFolder);
				return;
			} catch (e) {
				console.log('Could not read daily-notes.json directly, trying alternative methods');
			}
			
			// Пробуем получить через API плагинов
			// @ts-expect-error - internalPlugins доступен во время выполнения
			const dailyNotesPlugin = this.app.internalPlugins?.plugins['daily-notes'];
			if (dailyNotesPlugin?.enabled) {
				// Доступ к настройкам плагина через instance.options
				const settings = dailyNotesPlugin.instance?.options || {};
				this.dailyNotesFormat = settings.format || 'YYYY-MM-DD';
				this.dailyNotesFolder = settings.folder || '';
				
				console.log('Daily Notes settings loaded from plugin:', this.dailyNotesFormat, this.dailyNotesFolder);
			} else {
				// Попробуем загрузить настройки из плагина Periodic Notes, если он установлен
				// @ts-expect-error - plugins доступен во время выполнения
				const periodicNotesPlugin = this.app.plugins?.plugins['periodic-notes'];
				if (periodicNotesPlugin) {
					// Доступ к внутренним настройкам плагина
					const settings = periodicNotesPlugin.settings?.daily;
					if (settings) {
						this.dailyNotesFormat = settings.format || 'YYYY-MM-DD';
						this.dailyNotesFolder = settings.folder || '';
						console.log('Periodic Notes settings loaded:', this.dailyNotesFormat, this.dailyNotesFolder);
					}
				}
			}
		} catch (error) {
			console.error('Failed to load Daily Notes settings:', error);
			// Используем значения по умолчанию
			this.dailyNotesFormat = 'YYYY-MM-DD';
			this.dailyNotesFolder = '';
		}
	}

	private isDailyNote(path: string): boolean {
		// Проверка на принадлежность к папке с ежедневными заметками
		if (this.dailyNotesFolder && path.includes(`${this.dailyNotesFolder}/`)) {
			return true;
		}
		
		// Проверка на соответствие формату даты из настроек
		if (this.dailyNotesFormat) {
			try {
				// Получаем имя файла без пути и расширения
				const fileName = path.split(/[\/\\]/).pop()?.split('.')[0] || '';
				
				// Пробуем распознать дату в формате из настроек
				// Преобразуем формат из настроек в формат moment.js
				// yyyy-mm-dd -> YYYY-MM-DD
				const momentFormat = this.dailyNotesFormat
					.replace(/yyyy/g, 'YYYY')
					.replace(/yy/g, 'YY')
					.replace(/mm/g, 'MM')
					.replace(/m/g, 'M')
					.replace(/dd/g, 'DD')
					.replace(/d/g, 'D');
				
				console.log(`Checking if ${fileName} matches format ${momentFormat}`);
				const date = moment(fileName, momentFormat, true);
				return date.isValid();
			} catch (error) {
				console.error('Error parsing date format:', error);
			}
		}
		
		// Запасной вариант - проверка по старому методу
		return path.includes("Заметки/") || /\d{4}-\d{2}-\d{2}/.test(path);
	}
	
	private isLeafInRightSplit(leaf: WorkspaceLeaf): boolean {
		// @ts-expect-error containerEl is available at runtime, but not in types
		return leaf.getRoot().containerEl?.classList.contains("mod-right-split");
	}
	
	private async ensureDailyNotesLeaf() {
		const rightLeaves = this.app.workspace.getLeavesOfType("markdown")
			.filter(leaf => this.isLeafInRightSplit(leaf));

		if (rightLeaves.length > 0) {
			this.dailyNotesLeaf = rightLeaves[0];
		}
		else {
			this.dailyNotesLeaf = this.app.workspace.getRightLeaf(false);
			await this.dailyNotesLeaf?.setViewState({ type: "markdown", active: true });
			if (this.dailyNotesLeaf) {
				this.app.workspace.revealLeaf(this.dailyNotesLeaf);
			}
		}
	}

	private async openInRightLeaf(file: TFile) {
		if (!this.dailyNotesLeaf) {
			await this.ensureDailyNotesLeaf();
		}

		if (this.dailyNotesLeaf) {
			if (this.dailyNotesLeaf.view) {
				await this.dailyNotesLeaf.setViewState({ type: "empty" });
			}

			await this.dailyNotesLeaf.openFile(file, { active: false });
		}
	}

	private async restorePreviousFileInMainSplit(currentFile: TFile) {
		// Найдем все листы в основном окне, где открыта текущая заметка
		const mainLeaves = this.app.workspace.getLeavesOfType("markdown")
			.filter(leaf => !this.isLeafInRightSplit(leaf) && 
				(leaf.view as MarkdownView).file?.path === currentFile.path);
		
		if (mainLeaves.length === 0) return;
		
		let fileToOpen: TFile | null = this.lastActiveFile;
		
		if (!fileToOpen) {
			const lastOpenFiles = this.app.workspace.getLastOpenFiles();
			for (const filePath of lastOpenFiles) {
				if (filePath !== currentFile.path) {
					const file = this.app.vault.getFileByPath(filePath);
					if (file) {
						fileToOpen = file;
						break;
					}
				}
			}
		}
		
		if (fileToOpen) {
			for (const leaf of mainLeaves) {
				await leaf.openFile(fileToOpen, { active: false });
			}
		}
		
		if (this.dailyNotesLeaf) {
			this.app.workspace.setActiveLeaf(this.dailyNotesLeaf, { focus: true });
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: DailyNotesInSidebarPlugin;

	constructor(app: App, plugin: DailyNotesInSidebarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
