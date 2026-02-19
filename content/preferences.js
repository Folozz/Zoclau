/**
 * Zoclau Preferences Pane Script.
 * All controls auto-save.
 */

const ZOCLAU_PREF_PREFIX = 'extensions.zotero.zoclau.';
const LEGACY_PREF_SOURCES = [
    { prefix: 'extensions.zotero.zeclau.', global: true },
    { prefix: 'zoclau.', global: false },
    { prefix: 'zeclau.', global: false },
];

const DEFAULT_SETTINGS = {
    userName: '',
    model: 'auto',
    thinkingBudget: 'off',
    systemPrompt: '',
    environmentVariables: '',
    claudeCliPath: '',
    workingDirectory: '',
    permissionMode: 'yolo',
    enableAutoScroll: true,
    loadUserClaudeSettings: true,
    blockedCommandsWindows: [
        'del /s /q',
        'rd /s /q',
        'rmdir /s /q',
        'format',
        'diskpart',
        'Remove-Item -Recurse -Force',
    ].join('\n'),
    blockedCommandsUnix: [
        'rm -rf',
        'chmod 777',
        'chmod -R 777',
    ].join('\n'),
};

const PREF_CONTROL_IDS = [
    'zoclau-pref-clipath',
    'zoclau-pref-workdir',
    'zoclau-pref-permission',
    'zoclau-pref-autoscroll',
    'zoclau-pref-load-user-settings',
    'zoclau-pref-blocked-cmd-win',
    'zoclau-pref-blocked-cmd-unix',
];

const VALID_PERMISSION_MODES = new Set(['yolo', 'normal', 'plan']);
const VALID_THINKING_BUDGETS = new Set(['off', 'low', 'medium', 'high', 'max']);
const MODEL_ENV_KEYS = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];

let autoSaveTimer = null;

function byId(id) {
    return document.getElementById(id);
}

function zoclauPrefLog(message) {
    try {
        const file = Services.dirsvc.get('ProfD', Components.interfaces.nsIFile);
        file.append('zoclau-debug.log');

        const foStream = Components.classes['@mozilla.org/network/file-output-stream;1']
            .createInstance(Components.interfaces.nsIFileOutputStream);
        foStream.init(file, 0x02 | 0x08 | 0x10, 420, 0);

        const converter = Components.classes['@mozilla.org/intl/converter-output-stream;1']
            .createInstance(Components.interfaces.nsIConverterOutputStream);
        converter.init(foStream, 'UTF-8', 0, 0);
        converter.writeString(new Date().toISOString() + ' [Zoclau:Prefs] ' + message + '\n');
        converter.close();
    } catch {
        // ignore
    }
}

function flushPrefs() {
    try {
        Services.prefs.savePrefFile(null);
    } catch {
        // ignore
    }
}

function toStringValue(value, fallback) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function toBooleanValue(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    return fallback;
}

function toMultilineListValue(value, fallback) {
    const text = toStringValue(value, fallback);
    const lines = String(text || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !!line && !line.startsWith('#'));
    return lines.join('\n');
}

function getPref(key, fallback) {
    const fullKey = ZOCLAU_PREF_PREFIX + key;

    try {
        const globalValue = Zotero.Prefs.get(fullKey, true);
        if (globalValue !== undefined && globalValue !== null) {
            return globalValue;
        }
    } catch {
        // ignore
    }

    try {
        const localValue = Zotero.Prefs.get(fullKey);
        if (localValue !== undefined && localValue !== null) {
            return localValue;
        }
    } catch {
        // ignore
    }

    for (const source of LEGACY_PREF_SOURCES) {
        try {
            const legacyKey = source.prefix + key;
            const legacy = source.global
                ? Zotero.Prefs.get(legacyKey, true)
                : Zotero.Prefs.get(legacyKey);
            if (legacy !== undefined && legacy !== null) {
                return legacy;
            }
        } catch {
            // ignore
        }
    }

    return fallback;
}

function setPref(key, value) {
    const fullKey = ZOCLAU_PREF_PREFIX + key;
    try {
        Zotero.Prefs.set(fullKey, value, true);
    } catch {
        try {
            Zotero.Prefs.set(fullKey, value);
        } catch {
            // ignore
        }
    }

    for (const source of LEGACY_PREF_SOURCES) {
        const legacyKey = source.prefix + key;
        try {
            if (source.global) {
                Zotero.Prefs.set(legacyKey, value, true);
            } else {
                Zotero.Prefs.set(legacyKey, value);
            }
        } catch {
            // ignore
        }
    }
}

function setStatus(text, isError) {
    const statusEl = byId('zoclau-pref-status');
    if (!statusEl) return;

    statusEl.setAttribute('value', text || '');
    statusEl.style.color = isError ? '#9f1239' : '#0f766e';
}

function setInlineStatus(id, text, state) {
    const el = byId(id);
    if (!el) return;

    el.setAttribute('value', text || '');
    el.classList.remove('is-ok', 'is-error', 'is-warn');
    if (state === 'ok') {
        el.classList.add('is-ok');
    } else if (state === 'error') {
        el.classList.add('is-error');
    } else if (state === 'warn') {
        el.classList.add('is-warn');
    }
}

function readMenulist(id, fallback) {
    const el = byId(id);
    if (!el) return fallback;

    if (el.value) return el.value;
    if (el.selectedItem && el.selectedItem.value) return el.selectedItem.value;
    return fallback;
}

function writeMenulist(id, value, fallback) {
    const el = byId(id);
    if (!el) return;

    const next = value || fallback;
    el.value = next;
    if (!el.value && el.menupopup) {
        const first = el.menupopup.firstElementChild;
        if (first && first.value) {
            el.value = first.value;
        }
    }
}

function readTextbox(id) {
    const el = byId(id);
    return el ? (el.value || '').toString() : '';
}

function writeTextbox(id, value) {
    const el = byId(id);
    if (!el) return;
    el.value = value || '';
}

function readCheckbox(id, fallback) {
    const el = byId(id);
    return el ? !!el.checked : !!fallback;
}

function writeCheckbox(id, value, fallback) {
    const el = byId(id);
    if (!el) return;
    el.checked = typeof value === 'boolean' ? value : !!fallback;
}

function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};

    const model = toStringValue(src.model, DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model;
    const thinkingBudget = toStringValue(src.thinkingBudget, DEFAULT_SETTINGS.thinkingBudget).trim();
    const permissionMode = toStringValue(src.permissionMode, DEFAULT_SETTINGS.permissionMode).trim();

    return {
        userName: toStringValue(src.userName, DEFAULT_SETTINGS.userName).trim(),
        model,
        thinkingBudget: VALID_THINKING_BUDGETS.has(thinkingBudget) ? thinkingBudget : DEFAULT_SETTINGS.thinkingBudget,
        systemPrompt: toStringValue(src.systemPrompt, DEFAULT_SETTINGS.systemPrompt),
        environmentVariables: toStringValue(src.environmentVariables, DEFAULT_SETTINGS.environmentVariables),
        claudeCliPath: toStringValue(src.claudeCliPath, DEFAULT_SETTINGS.claudeCliPath).trim(),
        workingDirectory: toStringValue(src.workingDirectory, DEFAULT_SETTINGS.workingDirectory).trim(),
        permissionMode: VALID_PERMISSION_MODES.has(permissionMode) ? permissionMode : DEFAULT_SETTINGS.permissionMode,
        enableAutoScroll: toBooleanValue(src.enableAutoScroll, DEFAULT_SETTINGS.enableAutoScroll),
        loadUserClaudeSettings: toBooleanValue(src.loadUserClaudeSettings, DEFAULT_SETTINGS.loadUserClaudeSettings),
        blockedCommandsWindows: toMultilineListValue(src.blockedCommandsWindows, DEFAULT_SETTINGS.blockedCommandsWindows),
        blockedCommandsUnix: toMultilineListValue(src.blockedCommandsUnix, DEFAULT_SETTINGS.blockedCommandsUnix),
    };
}

function readSettingsFromControls() {
    const current = readSettingsFromPrefs();
    return sanitizeSettings({
        ...current,
        claudeCliPath: readTextbox('zoclau-pref-clipath'),
        workingDirectory: readTextbox('zoclau-pref-workdir'),
        permissionMode: readMenulist('zoclau-pref-permission', DEFAULT_SETTINGS.permissionMode),
        enableAutoScroll: readCheckbox('zoclau-pref-autoscroll', DEFAULT_SETTINGS.enableAutoScroll),
        loadUserClaudeSettings: readCheckbox('zoclau-pref-load-user-settings', DEFAULT_SETTINGS.loadUserClaudeSettings),
        blockedCommandsWindows: readTextbox('zoclau-pref-blocked-cmd-win'),
        blockedCommandsUnix: readTextbox('zoclau-pref-blocked-cmd-unix'),
    });
}

function writeSettingsToControls(settings) {
    const next = sanitizeSettings(settings);

    writeTextbox('zoclau-pref-clipath', next.claudeCliPath);
    writeTextbox('zoclau-pref-workdir', next.workingDirectory);

    writeMenulist('zoclau-pref-permission', next.permissionMode, DEFAULT_SETTINGS.permissionMode);

    writeCheckbox('zoclau-pref-autoscroll', next.enableAutoScroll, DEFAULT_SETTINGS.enableAutoScroll);
    writeCheckbox('zoclau-pref-load-user-settings', next.loadUserClaudeSettings, DEFAULT_SETTINGS.loadUserClaudeSettings);
    writeTextbox('zoclau-pref-blocked-cmd-win', next.blockedCommandsWindows);
    writeTextbox('zoclau-pref-blocked-cmd-unix', next.blockedCommandsUnix);
}

function readSettingsFromPrefs() {
    return sanitizeSettings({
        userName: getPref('userName', DEFAULT_SETTINGS.userName),
        model: getPref('model', DEFAULT_SETTINGS.model),
        thinkingBudget: getPref('thinkingBudget', DEFAULT_SETTINGS.thinkingBudget),
        systemPrompt: getPref('systemPrompt', DEFAULT_SETTINGS.systemPrompt),
        environmentVariables: getPref('environmentVariables', DEFAULT_SETTINGS.environmentVariables),
        claudeCliPath: getPref('claudeCliPath', DEFAULT_SETTINGS.claudeCliPath),
        workingDirectory: getPref('workingDirectory', DEFAULT_SETTINGS.workingDirectory),
        permissionMode: getPref('permissionMode', DEFAULT_SETTINGS.permissionMode),
        enableAutoScroll: getPref('enableAutoScroll', DEFAULT_SETTINGS.enableAutoScroll),
        loadUserClaudeSettings: getPref('loadUserClaudeSettings', DEFAULT_SETTINGS.loadUserClaudeSettings),
        blockedCommandsWindows: getPref('blockedCommandsWindows', DEFAULT_SETTINGS.blockedCommandsWindows),
        blockedCommandsUnix: getPref('blockedCommandsUnix', DEFAULT_SETTINGS.blockedCommandsUnix),
    });
}

function writeSettingsToPrefs(settings) {
    const safe = sanitizeSettings(settings);
    setPref('userName', safe.userName);
    setPref('model', safe.model);
    setPref('thinkingBudget', safe.thinkingBudget);
    setPref('systemPrompt', safe.systemPrompt);
    setPref('environmentVariables', safe.environmentVariables);
    setPref('claudeCliPath', safe.claudeCliPath);
    setPref('workingDirectory', safe.workingDirectory);
    setPref('permissionMode', safe.permissionMode);
    setPref('enableAutoScroll', safe.enableAutoScroll);
    setPref('loadUserClaudeSettings', safe.loadUserClaudeSettings);
    setPref('blockedCommandsWindows', safe.blockedCommandsWindows);
    setPref('blockedCommandsUnix', safe.blockedCommandsUnix);
}

function createLocalFile(path) {
    if (!path || typeof path !== 'string') return null;
    const trimmed = path.trim();
    if (!trimmed) return null;

    try {
        const file = Components.classes['@mozilla.org/file/local;1']
            .createInstance(Components.interfaces.nsIFile);
        file.initWithPath(trimmed);
        return file;
    } catch {
        return null;
    }
}

function isExistingFile(path) {
    const file = createLocalFile(path);
    if (!file) return false;
    try {
        return file.exists() && file.isFile();
    } catch {
        return false;
    }
}

function isExistingDirectory(path) {
    const file = createLocalFile(path);
    if (!file) return false;
    try {
        return file.exists() && file.isDirectory();
    } catch {
        return false;
    }
}

function parseEnvironmentVariablesDetailed(text) {
    const vars = {};
    const errors = [];
    let duplicateCount = 0;
    let validCount = 0;

    if (!text || !text.trim()) {
        return { vars, errors, duplicateCount, validCount };
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const clean = trimmed.replace(/^export\s+/, '');
        const eqIdx = clean.indexOf('=');
        if (eqIdx <= 0) {
            errors.push(`第 ${lineNo} 行缺少 '='：${trimmed}`);
            continue;
        }

        const key = clean.substring(0, eqIdx).trim();
        let value = clean.substring(eqIdx + 1).trim();

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            errors.push(`第 ${lineNo} 行变量名无效：${key}`);
            continue;
        }

        if (
            (value.startsWith('"') && !value.endsWith('"')) ||
            (value.startsWith("'") && !value.endsWith("'"))
        ) {
            errors.push(`第 ${lineNo} 行引号未闭合：${key}`);
            continue;
        }

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (Object.prototype.hasOwnProperty.call(vars, key)) {
            duplicateCount += 1;
        }

        vars[key] = value;
        validCount += 1;
    }

    return { vars, errors, duplicateCount, validCount };
}

function getModelTypeFromEnvKey(key) {
    if (key === 'ANTHROPIC_MODEL') return 'model';
    const match = key.match(/ANTHROPIC_DEFAULT_(\w+)_MODEL/);
    return match ? match[1].toLowerCase() : key.toLowerCase();
}

function collectModelOptionsFromEnv(envVars) {
    const map = new Map();

    for (const envKey of MODEL_ENV_KEYS) {
        const modelValue = (envVars[envKey] || '').trim();
        if (!modelValue) continue;

        const type = getModelTypeFromEnvKey(envKey);
        const label = modelValue.includes('/')
            ? (modelValue.split('/').pop() || modelValue)
            : modelValue.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

        if (!map.has(modelValue)) {
            map.set(modelValue, { label, types: [type] });
        } else {
            map.get(modelValue).types.push(type);
        }
    }

    return Array.from(map.entries()).map(([value, info]) => {
        const typeText = info.types.join(', ');
        return {
            value,
            label: `${info.label}（${typeText}）`,
        };
    });
}

function getMenuItems(menulist) {
    if (!menulist || !menulist.menupopup) return [];
    return Array.from(menulist.menupopup.children);
}

function hasMenuValue(menulist, value) {
    return getMenuItems(menulist).some((item) => item.value === value);
}

function addDynamicModelItem(menulist, value, label) {
    if (!menulist || !menulist.menupopup) return;

    const item = document.createElement('menuitem');
    item.setAttribute('label', label);
    item.setAttribute('value', value);
    item.setAttribute('data-zoclau-dynamic-model', '1');
    menulist.menupopup.appendChild(item);
}

function refreshModelOptions(preferredValue) {
    const modelEl = byId('zoclau-pref-model');
    if (!modelEl) return { validCount: 0, errors: [], duplicateCount: 0 };

    for (const item of getMenuItems(modelEl)) {
        if (item.getAttribute('data-zoclau-dynamic-model') === '1') {
            item.remove();
        }
    }

    const envInfo = parseEnvironmentVariablesDetailed(readTextbox('zoclau-pref-envvars'));
    const dynamicOptions = collectModelOptionsFromEnv(envInfo.vars);

    for (const option of dynamicOptions) {
        if (!hasMenuValue(modelEl, option.value)) {
            addDynamicModelItem(modelEl, option.value, option.label);
        }
    }

    const selectedValue = toStringValue(preferredValue, readMenulist('zoclau-pref-model', 'auto')).trim() || 'auto';
    if (!hasMenuValue(modelEl, selectedValue)) {
        addDynamicModelItem(modelEl, selectedValue, `${selectedValue}（当前值）`);
    }

    modelEl.value = hasMenuValue(modelEl, selectedValue) ? selectedValue : 'auto';

    if (dynamicOptions.length > 0) {
        setInlineStatus('zoclau-pref-model-hint', `检测到 ${dynamicOptions.length} 个自定义模型。`, 'ok');
    } else {
        setInlineStatus('zoclau-pref-model-hint', '未检测到自定义模型。', '');
    }

    return envInfo;
}

function renderDiagnostics() {
    const cliPath = readTextbox('zoclau-pref-clipath').trim();
    if (!cliPath) {
        setInlineStatus('zoclau-pref-cli-status', '未填写 CLI 路径，将在启动时自动检测。', 'warn');
    } else if (isExistingFile(cliPath)) {
        setInlineStatus('zoclau-pref-cli-status', 'CLI 路径有效。', 'ok');
    } else {
        setInlineStatus('zoclau-pref-cli-status', 'CLI 路径无效：文件不存在或不可访问。', 'error');
    }

    const workdir = readTextbox('zoclau-pref-workdir').trim();
    if (!workdir) {
        setInlineStatus('zoclau-pref-workdir-status', '未填写工作目录，将使用 Zotero 配置目录。', 'warn');
    } else if (isExistingDirectory(workdir)) {
        setInlineStatus('zoclau-pref-workdir-status', '工作目录有效。', 'ok');
    } else {
        setInlineStatus('zoclau-pref-workdir-status', '工作目录无效：目录不存在或不可访问。', 'error');
    }

    const winRules = toMultilineListValue(readTextbox('zoclau-pref-blocked-cmd-win'), '').split('\n').filter(Boolean);
    const unixRules = toMultilineListValue(readTextbox('zoclau-pref-blocked-cmd-unix'), '').split('\n').filter(Boolean);
    const totalRules = winRules.length + unixRules.length;
    setInlineStatus('zoclau-pref-blocklist-status', `命令黑名单规则 ${totalRules} 项。`, totalRules > 0 ? 'ok' : 'warn');
}

function loadValues() {
    writeSettingsToControls(readSettingsFromPrefs());
}

function saveValues() {
    writeSettingsToPrefs(readSettingsFromControls());
}

function persistNow(statusText) {
    saveValues();
    flushPrefs();
    renderDiagnostics();
    setStatus(statusText || '设置已自动保存。', false);
}

function scheduleAutoSave() {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        try {
            persistNow('设置已自动保存。');
            zoclauPrefLog('auto-saved');
        } catch (e) {
            setStatus('自动保存失败：' + e, true);
            zoclauPrefLog('auto-save failed: ' + e);
        }
    }, 280);
}

function onControlInput() {
    renderDiagnostics();
    scheduleAutoSave();
}

function onTextboxInput() {
    scheduleAutoSave();
}

function bindControlAutoSave() {
    for (const id of PREF_CONTROL_IDS) {
        const el = byId(id);
        if (!el) continue;

        const localName = String(el.localName || '').toLowerCase();
        if (localName === 'textbox') {
            el.addEventListener('input', onTextboxInput);
            el.addEventListener('change', onControlInput);
            continue;
        }

        el.addEventListener('command', onControlInput);
        el.addEventListener('change', onControlInput);
        el.addEventListener('click', onControlInput);
        el.addEventListener('input', onControlInput);
    }
}

function ensureControlsEditable() {
    for (const id of PREF_CONTROL_IDS) {
        const el = byId(id);
        if (!el) continue;

        const localName = String(el.localName || '').toLowerCase();
        if (localName !== 'textbox') continue;

        try {
            el.removeAttribute('readonly');
            el.removeAttribute('disabled');
            el.readOnly = false;
            el.disabled = false;
            if (el.inputField) {
                el.inputField.readOnly = false;
                el.inputField.disabled = false;
            }
        } catch {
            // ignore
        }
    }
}

// eslint-disable-next-line no-unused-vars
var ZoclauPreferences = {
    initialized: false,

    init: function () {
        if (this.initialized) return;
        this.initialized = true;

        zoclauPrefLog('preferences init');

        loadValues();
        ensureControlsEditable();
        renderDiagnostics();
        bindControlAutoSave();
        setStatus('', false);

        try {
            Zotero.debug('[Zoclau] Preferences pane initialized');
        } catch {
            // ignore
        }
    },
};

zoclauPrefLog('preferences script loaded');

function ensureInit() {
    try {
        ZoclauPreferences.init();
    } catch (e) {
        zoclauPrefLog('init failed: ' + e);
    }
}

if (document.readyState === 'interactive' || document.readyState === 'complete') {
    ensureInit();
}

window.addEventListener('load', ensureInit, { once: true });

window.addEventListener('unload', function () {
    if (!ZoclauPreferences.initialized) return;
    try {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
        saveValues();
        flushPrefs();
        zoclauPrefLog('settings flushed on unload');
    } catch {
        // ignore
    }
});
