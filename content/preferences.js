/**
 * Zoclau Preferences Pane Script.
 */

const ZECLAU_PREF_PREFIX = 'extensions.zotero.zeclau.';
const PREF_CONTROL_IDS = [
    'zeclau-pref-model',
    'zeclau-pref-thinking',
    'zeclau-pref-clipath',
    'zeclau-pref-workdir',
    'zeclau-pref-permission',
    'zeclau-pref-username',
    'zeclau-pref-systemprompt',
    'zeclau-pref-envvars',
    'zeclau-pref-autoscroll',
    'zeclau-pref-blocklist',
];

let autoSaveTimer = null;

function zeclauPrefLog(message) {
    try {
        var file = Services.dirsvc.get('ProfD', Components.interfaces.nsIFile);
        file.append('zeclau-debug.log');

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
        const fullKey = ZECLAU_PREF_PREFIX + key;
        const direct = Zotero.Prefs.get(fullKey, true);
        if (direct !== undefined && direct !== null) {
            return direct;
        }

        const legacy = Zotero.Prefs.get('zeclau.' + key);
        return legacy === undefined || legacy === null ? fallback : legacy;
    } catch {
        return fallback;
    }
}

function setPref(key, value) {
    Zotero.Prefs.set(ZECLAU_PREF_PREFIX + key, value, true);
    Zotero.Prefs.set('zeclau.' + key, value);
}

function setStatus(text, isError) {
    var statusEl = document.getElementById('zeclau-pref-status');
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
    writeMenulist('zeclau-pref-model', getPref('model', 'auto'), 'auto');
    writeMenulist('zeclau-pref-thinking', getPref('thinkingBudget', 'off'), 'off');
    writeTextbox('zeclau-pref-clipath', getPref('claudeCliPath', ''));
    writeTextbox('zeclau-pref-workdir', getPref('workingDirectory', ''));
    writeMenulist('zeclau-pref-permission', getPref('permissionMode', 'yolo'), 'yolo');
    writeTextbox('zeclau-pref-username', getPref('userName', ''));
    writeTextbox('zeclau-pref-systemprompt', getPref('systemPrompt', ''));
    writeTextbox('zeclau-pref-envvars', getPref('environmentVariables', ''));
    writeCheckbox('zeclau-pref-autoscroll', getPref('enableAutoScroll', true), true);
    writeCheckbox('zeclau-pref-blocklist', getPref('enableBlocklist', true), true);
}

function saveValues() {
    setPref('model', readMenulist('zeclau-pref-model', 'auto'));
    setPref('thinkingBudget', readMenulist('zeclau-pref-thinking', 'off'));
    setPref('claudeCliPath', readTextbox('zeclau-pref-clipath').trim());
    setPref('workingDirectory', readTextbox('zeclau-pref-workdir').trim());
    setPref('permissionMode', readMenulist('zeclau-pref-permission', 'yolo'));
    setPref('userName', readTextbox('zeclau-pref-username').trim());
    setPref('systemPrompt', readTextbox('zeclau-pref-systemprompt'));
    setPref('environmentVariables', readTextbox('zeclau-pref-envvars'));
    setPref('enableAutoScroll', readCheckbox('zeclau-pref-autoscroll', true));
    setPref('enableBlocklist', readCheckbox('zeclau-pref-blocklist', true));
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
            zeclauPrefLog('auto-saved');
        } catch (e) {
            setStatus('自动保存失败：' + e, true);
            zeclauPrefLog('auto-save failed: ' + e);
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
var ZeClauPreferences = {
    initialized: false,

    init: function () {
        if (this.initialized) return;
        this.initialized = true;

        zeclauPrefLog('preferences init');

        loadValues();
        bindControlAutoSave();

        const saveBtn = byId('zeclau-pref-save');
        bindAction(saveBtn, function () {
            try {
                persistNow('设置已保存。');
                zeclauPrefLog('settings saved');
            } catch (e) {
                setStatus('保存失败：' + e, true);
                zeclauPrefLog('save failed: ' + e);
            }
        });

        const reloadBtn = byId('zeclau-pref-reload');
        bindAction(reloadBtn, function () {
            loadValues();
            setStatus('已从偏好设置重新加载。', false);
            zeclauPrefLog('settings reloaded');
        });

        try {
            Zotero.debug('[Zoclau] Preferences pane initialized');
        } catch {
            // ignore
        }
    },
};

zeclauPrefLog('preferences script loaded');

function ensureInit() {
    try {
        ZeClauPreferences.init();
    } catch (e) {
        zeclauPrefLog('init failed: ' + e);
    }
}

if (document.readyState === 'interactive' || document.readyState === 'complete') {
    ensureInit();
}

window.addEventListener('load', ensureInit, { once: true });

window.addEventListener('unload', function () {
    if (!ZeClauPreferences.initialized) return;
    try {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
        saveValues();
        flushPrefs();
        zeclauPrefLog('settings flushed on unload');
    } catch {
        // ignore
    }
});
