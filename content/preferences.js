/**
 * Zoclau Preferences Pane Script.
 */

const ZOCLAU_PREF_PREFIX = 'extensions.zotero.zoclau.';
const LEGACY_PREF_SOURCES = [
    { prefix: 'extensions.zotero.zeclau.', global: true },
    { prefix: 'zoclau.', global: false },
    { prefix: 'zeclau.', global: false },
];
const PREF_CONTROL_IDS = [
    'zoclau-pref-model',
    'zoclau-pref-thinking',
    'zoclau-pref-clipath',
    'zoclau-pref-workdir',
    'zoclau-pref-permission',
    'zoclau-pref-username',
    'zoclau-pref-systemprompt',
    'zoclau-pref-envvars',
    'zoclau-pref-autoscroll',
    'zoclau-pref-blocklist',
];

let autoSaveTimer = null;

function zoclauPrefLog(message) {
    try {
        var file = Services.dirsvc.get('ProfD', Components.interfaces.nsIFile);
        file.append('zoclau-debug.log');

        var foStream = Components.classes['@mozilla.org/network/file-output-stream;1']
            .createInstance(Components.interfaces.nsIFileOutputStream);
        // write | create | append
        foStream.init(file, 0x02 | 0x08 | 0x10, 420, 0);

        var converter = Components.classes['@mozilla.org/intl/converter-output-stream;1']
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

function getPref(key, fallback) {
    try {
        const fullKey = ZOCLAU_PREF_PREFIX + key;
        const direct = Zotero.Prefs.get(fullKey, true);
        if (direct !== undefined && direct !== null) {
            return direct;
        }

        for (const source of LEGACY_PREF_SOURCES) {
            const legacyKey = source.prefix + key;
            const legacy = source.global
                ? Zotero.Prefs.get(legacyKey, true)
                : Zotero.Prefs.get(legacyKey);
            if (legacy !== undefined && legacy !== null) {
                return legacy;
            }
        }
    } catch {
        // ignore and use fallback
    }
    return fallback;
}

function setPref(key, value) {
    Zotero.Prefs.set(ZOCLAU_PREF_PREFIX + key, value, true);
    for (const source of LEGACY_PREF_SOURCES) {
        const legacyKey = source.prefix + key;
        if (source.global) {
            Zotero.Prefs.set(legacyKey, value, true);
        } else {
            Zotero.Prefs.set(legacyKey, value);
        }
    }
}

function setStatus(text, isError) {
    var statusEl = document.getElementById('zoclau-pref-status');
    if (!statusEl) return;

    statusEl.setAttribute('value', text || '');
    statusEl.style.color = isError ? '#9f1239' : '#0f766e';
}

function byId(id) {
    return document.getElementById(id);
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

function loadValues() {
    writeMenulist('zoclau-pref-model', getPref('model', 'auto'), 'auto');
    writeMenulist('zoclau-pref-thinking', getPref('thinkingBudget', 'off'), 'off');
    writeTextbox('zoclau-pref-clipath', getPref('claudeCliPath', ''));
    writeTextbox('zoclau-pref-workdir', getPref('workingDirectory', ''));
    writeMenulist('zoclau-pref-permission', getPref('permissionMode', 'yolo'), 'yolo');
    writeTextbox('zoclau-pref-username', getPref('userName', ''));
    writeTextbox('zoclau-pref-systemprompt', getPref('systemPrompt', ''));
    writeTextbox('zoclau-pref-envvars', getPref('environmentVariables', ''));
    writeCheckbox('zoclau-pref-autoscroll', getPref('enableAutoScroll', true), true);
    writeCheckbox('zoclau-pref-blocklist', getPref('enableBlocklist', true), true);
}

function saveValues() {
    setPref('model', readMenulist('zoclau-pref-model', 'auto'));
    setPref('thinkingBudget', readMenulist('zoclau-pref-thinking', 'off'));
    setPref('claudeCliPath', readTextbox('zoclau-pref-clipath').trim());
    setPref('workingDirectory', readTextbox('zoclau-pref-workdir').trim());
    setPref('permissionMode', readMenulist('zoclau-pref-permission', 'yolo'));
    setPref('userName', readTextbox('zoclau-pref-username').trim());
    setPref('systemPrompt', readTextbox('zoclau-pref-systemprompt'));
    setPref('environmentVariables', readTextbox('zoclau-pref-envvars'));
    setPref('enableAutoScroll', readCheckbox('zoclau-pref-autoscroll', true));
    setPref('enableBlocklist', readCheckbox('zoclau-pref-blocklist', true));
}

function persistNow(statusText) {
    saveValues();
    flushPrefs();
    setStatus(statusText || '设置已保存。', false);
}

function scheduleAutoSave() {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(function () {
        autoSaveTimer = null;
        try {
            persistNow('已自动保存。');
            zoclauPrefLog('auto-saved');
        } catch (e) {
            setStatus('自动保存失败：' + e, true);
            zoclauPrefLog('auto-save failed: ' + e);
        }
    }, 260);
}

function bindAction(el, handler) {
    if (!el) return;
    el.addEventListener('command', handler);
    el.addEventListener('click', handler);
}

function bindControlAutoSave() {
    for (const id of PREF_CONTROL_IDS) {
        const el = byId(id);
        if (!el) continue;

        el.addEventListener('command', scheduleAutoSave);
        el.addEventListener('change', scheduleAutoSave);

        if (el.localName === 'textbox' || el.tagName === 'textbox') {
            el.addEventListener('input', scheduleAutoSave);
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
        bindControlAutoSave();

        const saveBtn = byId('zoclau-pref-save');
        bindAction(saveBtn, function () {
            try {
                persistNow('设置已保存。');
                zoclauPrefLog('settings saved');
            } catch (e) {
                setStatus('保存失败：' + e, true);
                zoclauPrefLog('save failed: ' + e);
            }
        });

        const reloadBtn = byId('zoclau-pref-reload');
        bindAction(reloadBtn, function () {
            loadValues();
            setStatus('已从偏好设置重新加载。', false);
            zoclauPrefLog('settings reloaded');
        });

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
