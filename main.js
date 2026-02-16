const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    autoReplace: true,
    replacements: [] 
};

class AutoReplacePlugin extends obsidian.Plugin {
    async onload() {
        console.log("AutoReplace Plugin loaded");
        await this.loadSettings();
        this.addSettingTab(new AutoReplaceSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on("editor-change", (editor, info) => {
                if (!this.settings.autoReplace) return;
                const file = this.app.workspace.getActiveFile();
                this.handleReplacement(editor, file);
            })
        );

        this.addCommand({
            id: 'manual-replace-all',
            name: 'Заменить все ручные сокращения в текущей заметке',
            editorCallback: (editor, view) => {
                const file = this.app.workspace.getActiveFile();
                this.replaceManualInCurrentNote(editor, file);
            }
        });
    }

    async loadSettings() {
        try {
            const data = await this.loadData();
            this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

            if (this.settings.replacements && !Array.isArray(this.settings.replacements)) {
                const migrated = [];
                for (const [abbr, expanded] of Object.entries(this.settings.replacements)) {
                    migrated.push({ abbr, expanded, folder: "", manualOnly: false });
                }
                this.settings.replacements = migrated;
                await this.saveSettings();
            }
        } catch (error) {
            console.error("Failed to load settings:", error);
            this.settings = DEFAULT_SETTINGS;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getBestRule(word, filePath, isAutoMode) {
        let bestRule = null;
        let maxFolderMatch = -1;

        for (const rule of this.settings.replacements) {
            if (rule.abbr.toLowerCase() !== word.toLowerCase()) continue;
            if (isAutoMode && rule.manualOnly) continue;

            if (rule.folder) {
                if (filePath.startsWith(rule.folder) && rule.folder.length > maxFolderMatch) {
                    bestRule = rule;
                    maxFolderMatch = rule.folder.length;
                }
            } else if (maxFolderMatch === -1) {
                bestRule = rule;
            }
        }
        return bestRule;
    }

    handleReplacement(editor, file) {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);

        const lastChar = line[cursor.ch - 1];
        if (!lastChar || !/[\s.,!?;:]/.test(lastChar)) return;

        const textBeforeTrigger = line.slice(0, cursor.ch - 1);
        const match = textBeforeTrigger.match(/(\S+)$/);
        if (!match) return;

        const lastWord = match[1];
        const filePath = file ? file.path : "";
        
        const rule = this.getBestRule(lastWord, filePath, true);

        if (rule && lastWord !== rule.expanded) {
            const startCh = cursor.ch - 1 - lastWord.length;
            const endCh = cursor.ch - 1;
            editor.replaceRange(rule.expanded, { line: cursor.line, ch: startCh }, { line: cursor.line, ch: endCh });
        }
    }

    // --- ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ ФУНКЦИЯ РУЧНОЙ ЗАМЕНЫ ---
    replaceManualInCurrentNote(editor, file) {
        if (!file) return;
        
        const applicableRules = this.settings.replacements.filter(rule => {
            if (!rule.manualOnly) return false;
            if (rule.folder && !file.path.startsWith(rule.folder)) return false;
            return true;
        });

        if (applicableRules.length === 0) {
            new obsidian.Notice("Нет ручных сокращений для применения");
            return;
        }

        applicableRules.sort((a, b) => b.abbr.length - a.abbr.length);
        let replacedCount = 0;

        const cursor = editor.getCursor();
        const lineCount = editor.lineCount();

        // Проходим по каждой строке отдельно
        for (let i = 0; i < lineCount; i++) {
            const originalLine = editor.getLine(i);
            let newLine = originalLine;

            for (const rule of applicableRules) {
                const escapedAbbr = rule.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|[\\s.,!?;:\\n()\\[\\]{}<>])(${escapedAbbr})(?=$|[\\s.,!?;:\\n()\\[\\]{}<>])`, 'giu');

                newLine = newLine.replace(regex, (match, prefix) => {
                    replacedCount++;
                    return prefix + rule.expanded;
                });
            }

            if (newLine !== originalLine) {
                // 1. Меняем только измененную строку, не трогая весь документ
                editor.replaceRange(newLine, { line: i, ch: 0 }, { line: i, ch: originalLine.length });

                // 2. Умный пересчет позиции курсора, если замена произошла на его строке
                if (i === cursor.line) {
                    const textBeforeCursor = originalLine.slice(0, cursor.ch);
                    let newTextBeforeCursor = textBeforeCursor;

                    for (const rule of applicableRules) {
                        const escapedAbbr = rule.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`(^|[\\s.,!?;:\\n()\\[\\]{}<>])(${escapedAbbr})(?=$|[\\s.,!?;:\\n()\\[\\]{}<>])`, 'giu');
                        newTextBeforeCursor = newTextBeforeCursor.replace(regex, (match, prefix) => {
                            return prefix + rule.expanded;
                        });
                    }

                    // Вычисляем, на сколько символов удлинился (или укоротился) текст строго ДО курсора
                    const offset = newTextBeforeCursor.length - textBeforeCursor.length;
                    
                    // Сдвигаем курсор на эту разницу
                    editor.setCursor({ line: cursor.line, ch: cursor.ch + offset });
                }
            }
        }

        if (replacedCount > 0) {
            new obsidian.Notice(`Заменено ручных сокращений: ${replacedCount}`);
        } else {
            new obsidian.Notice("Ручные сокращения в этой заметке не найдены");
        }
    }
}

// --- ИНТЕРФЕЙС ОСТАВЛЕН БЕЗ ИЗМЕНЕНИЙ (Ровная таблица) ---
class AutoReplaceSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.draftSettings = null; 
        this.searchQuery = ""; 
        this.rowElements = []; 
        
        this.colAbbr = "flex: 1.5; min-width: 0; width: 100%;";
        this.colExp = "flex: 2.5; min-width: 0; width: 100%;";
        this.colFolder = "flex: 1.5; min-width: 0; width: 100%;";
        this.colManual = "flex: 0 0 60px; display: flex; justify-content: center; align-items: center;";
        this.colBtn = "flex: 0 0 80px; display: flex; justify-content: center; align-items: center;";
    }

    display() {
        this.draftSettings = JSON.parse(JSON.stringify(this.plugin.settings));
        this.renderUI();
    }

    renderUI() {
        const { containerEl } = this;
        containerEl.empty();
        this.rowElements = []; 

        const actionBar = containerEl.createDiv();
        actionBar.style.cssText = "position: sticky; top: -15px; background-color: var(--background-primary); z-index: 10; display: flex; justify-content: space-between; align-items: center; padding: 15px 0 10px 0; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 20px;";
        
        actionBar.createEl("h2", { text: "Настройки автозамены" }).style.margin = "0";

        const buttonsGroup = actionBar.createDiv();
        buttonsGroup.style.cssText = "display: flex; gap: 10px;";

        const cancelBtn = buttonsGroup.createEl("button", { text: "Отменить изменения" });
        cancelBtn.addEventListener("click", () => {
            this.draftSettings = JSON.parse(JSON.stringify(this.plugin.settings));
            this.searchQuery = ""; 
            this.renderUI();
            new obsidian.Notice("Изменения отменены");
        });

        const saveBtn = buttonsGroup.createEl("button", { text: "Сохранить настройки", cls: "mod-cta" });
        saveBtn.addEventListener("click", async () => {
            this.draftSettings.replacements = this.draftSettings.replacements.filter(r => r.abbr.trim() !== "" && r.expanded.trim() !== "");
            this.plugin.settings = JSON.parse(JSON.stringify(this.draftSettings));
            await this.plugin.saveSettings();
            this.renderUI();
            new obsidian.Notice("Настройки успешно сохранены!");
        });

        new obsidian.Setting(containerEl)
            .setName("Включить автозамену")
            .setDesc("Заменять текст автоматически при вводе пробела или знака препинания.")
            .addToggle(toggle => toggle
                .setValue(this.draftSettings.autoReplace)
                .onChange(value => {
                    this.draftSettings.autoReplace = value;
                })
            );

        containerEl.createEl("h3", { text: "Добавить новое правило" }).style.cssText = "margin-top: 25px; margin-bottom: 10px; color: var(--text-accent);";
        
        const addCard = containerEl.createDiv();
        addCard.style.cssText = "background-color: var(--background-secondary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border); margin-bottom: 30px;";

        const addHeaderRow = addCard.createDiv();
        addHeaderRow.style.cssText = "display: flex; gap: 10px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); width: 100%;";
        
        addHeaderRow.createDiv({ text: "Сокращение" }).style.cssText = this.colAbbr;
        addHeaderRow.createDiv({ text: "Полный текст" }).style.cssText = this.colExp;
        addHeaderRow.createDiv({ text: "Папка (опционально)" }).style.cssText = this.colFolder;
        addHeaderRow.createDiv({ text: "Ручной" }).style.cssText = this.colManual;
        addHeaderRow.createDiv().style.cssText = this.colBtn; 

        const addInputRow = addCard.createDiv();
        addInputRow.style.cssText = "display: flex; gap: 10px; align-items: center; width: 100%;";
        
        const newAbbrInput = addInputRow.createEl("input", { type: "text", placeholder: "Например: АГ" });
        newAbbrInput.style.cssText = this.colAbbr;
        
        const newExpInput = addInputRow.createEl("input", { type: "text", placeholder: "Артериальная гипертензия" });
        newExpInput.style.cssText = this.colExp;

        const newFolderInput = addInputRow.createEl("input", { type: "text", placeholder: "Например: Терапия" });
        newFolderInput.style.cssText = this.colFolder;
        
        const newToggleContainer = addInputRow.createDiv();
        newToggleContainer.style.cssText = this.colManual;
        const newManualToggle = newToggleContainer.createEl("input", { type: "checkbox" });
        
        const addBtnContainer = addInputRow.createDiv();
        addBtnContainer.style.cssText = this.colBtn;
        const addBtn = addBtnContainer.createEl("button", { text: "Добавить", cls: "mod-cta" });
        addBtn.style.width = "100%";

        let newAbbr = "", newExpanded = "", newFolder = "", newManual = false;
        newAbbrInput.addEventListener("input", (e) => newAbbr = e.target.value);
        newExpInput.addEventListener("input", (e) => newExpanded = e.target.value);
        newFolderInput.addEventListener("input", (e) => newFolder = e.target.value);
        newManualToggle.addEventListener("change", (e) => newManual = e.target.checked);

        addBtn.addEventListener("click", () => {
            if (newAbbr.trim() && newExpanded.trim()) {
                this.draftSettings.replacements.unshift({
                    abbr: newAbbr.trim(),
                    expanded: newExpanded.trim(),
                    folder: newFolder.trim(),
                    manualOnly: newManual
                });
                this.renderUI(); 
            } else {
                new obsidian.Notice("Заполните поля 'Сокращение' и 'Полный текст'");
            }
        });

        const listHeaderContainer = containerEl.createDiv();
        listHeaderContainer.style.cssText = "display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; margin-bottom: 15px;";
        
        listHeaderContainer.createEl("h3", { text: "Существующие правила" }).style.margin = "0";

        const searchInput = listHeaderContainer.createEl("input", { type: "search", placeholder: "Поиск по слову или папке..." });
        searchInput.style.width = "250px";
        searchInput.value = this.searchQuery;

        searchInput.addEventListener("input", (e) => {
            this.searchQuery = e.target.value.toLowerCase().trim();
            this.applyFilter();
        });

        if (this.draftSettings.replacements.length === 0) {
            containerEl.createDiv({ text: "Список сокращений пока пуст." }).style.cssText = "color: var(--text-muted); font-style: italic; margin-top: 10px;";
            return;
        }

        const listHeader = containerEl.createDiv();
        listHeader.style.cssText = "display: flex; gap: 10px; padding: 0 10px; margin-bottom: 5px; font-weight: 600; font-size: 12px; color: var(--text-muted); width: 100%;";
        
        listHeader.createDiv({ text: "Сокращение" }).style.cssText = this.colAbbr;
        listHeader.createDiv({ text: "Замена" }).style.cssText = this.colExp;
        listHeader.createDiv({ text: "Папка" }).style.cssText = this.colFolder;
        listHeader.createDiv({ text: "Ручной" }).style.cssText = this.colManual;
        listHeader.createDiv().style.cssText = this.colBtn; 

        const listContainer = containerEl.createDiv();
        listContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; width: 100%;";

        this.draftSettings.replacements.forEach((rule, index) => {
            const row = listContainer.createDiv();
            row.style.cssText = "display: flex; gap: 10px; align-items: center; padding: 10px; background-color: var(--background-secondary-alt); border-radius: 6px; border: 1px solid var(--background-modifier-border); width: 100%;";

            const abbrInput = row.createEl("input", { type: "text", value: rule.abbr });
            abbrInput.style.cssText = this.colAbbr;

            const expInput = row.createEl("input", { type: "text", value: rule.expanded });
            expInput.style.cssText = this.colExp;

            const folderInput = row.createEl("input", { type: "text", value: rule.folder, placeholder: "Везде" });
            folderInput.style.cssText = this.colFolder;
            
            const toggleContainer = row.createDiv();
            toggleContainer.style.cssText = this.colManual;
            const manualToggle = toggleContainer.createEl("input", { type: "checkbox" });
            manualToggle.checked = rule.manualOnly;

            const btnContainer = row.createDiv();
            btnContainer.style.cssText = this.colBtn;
            const deleteBtn = btnContainer.createEl("button", { text: "Удалить", cls: "mod-warning" });
            deleteBtn.style.width = "100%";

            abbrInput.addEventListener("input", (e) => rule.abbr = e.target.value);
            expInput.addEventListener("input", (e) => rule.expanded = e.target.value);
            folderInput.addEventListener("input", (e) => rule.folder = e.target.value);
            manualToggle.addEventListener("change", (e) => rule.manualOnly = e.target.checked);

            deleteBtn.addEventListener("click", () => {
                this.draftSettings.replacements.splice(index, 1);
                this.renderUI(); 
            });

            this.rowElements.push({ el: row, rule: rule });
        });

        this.applyFilter();
    }

    applyFilter() {
        this.rowElements.forEach(item => {
            const match = item.rule.abbr.toLowerCase().includes(this.searchQuery) ||
                          item.rule.expanded.toLowerCase().includes(this.searchQuery) ||
                          item.rule.folder.toLowerCase().includes(this.searchQuery);
            
            item.el.style.display = match ? "flex" : "none";
        });
    }
}

module.exports = AutoReplacePlugin;