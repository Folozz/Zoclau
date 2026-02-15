/**
 * Zoclau - Main plugin entry point for Zotero 7.
 *
 * Exports: init, shutdown, onMainWindowLoad, onMainWindowUnload
 * These are called by bootstrap.js lifecycle hooks.
 */

import { ClaudeService } from './service/ClaudeService';
import { ChatPanel } from './ui/ChatPanel';
import { ConversationManager } from './ui/ConversationManager';
import { loadSettings, saveSetting } from './settings/prefs';
import type { ZeClauSettings } from './settings/types';
import { findClaudeCli } from './utils/claudeCli';

declare const Zotero: any;
declare const Services: any;
declare const Components: any;

const CONTENT_BASE_URI = 'chrome://zeclau/content/';
const DISPLAY_NAME = 'Zoclau';
const SIDENAV_L10N_ID = 'zoclau-sidebar-sidenav';
const HEADER_L10N_ID = 'zoclau-sidebar-header';

function log(msg: string): void {
    const text = `[${DISPLAY_NAME}] ${msg}`;
    try {
        Zotero.debug(text);
    } catch {
        // ignore
    }

    try {
        Services.console.logStringMessage(text);
    } catch {
        // ignore
    }
}

// Plugin state
let pluginId: string;
let pluginVersion: string;
let settings: ZeClauSettings;
let service: ClaudeService;
let conversationManager: ConversationManager;
let styleSheetURI: string;
let sectionKey: string | false | null = null;

const SETTINGS_PREF_BRANCH = 'extensions.zotero.zeclau';
const SETTINGS_KEYS: (keyof ZeClauSettings)[] = [
    'userName',
    'model',
    'thinkingBudget',
    'systemPrompt',
    'environmentVariables',
    'claudeCliPath',
    'workingDirectory',
    'permissionMode',
    'enableAutoScroll',
    'enableBlocklist',
];

const panelByBody = new WeakMap<HTMLElement, ChatPanel>();
const activePanels = new Set<ChatPanel>();
const settingsObserverTokens: symbol[] = [];
let settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function applyUpdatedSettings(): void {
    try {
        settings = loadSettings();
        if (service) {
            service.updateSettings(settings);
        }

        for (const panel of activePanels) {
            panel.updateSettings(settings);
        }

        log('Applied updated settings from preferences');
    } catch (e) {
        log(`Failed to reload settings from prefs: ${e}`);
    }
}

function scheduleSettingsRefresh(): void {
    if (settingsRefreshTimer) {
        clearTimeout(settingsRefreshTimer);
    }

    settingsRefreshTimer = setTimeout(() => {
        settingsRefreshTimer = null;
        applyUpdatedSettings();
    }, 80);
}

function registerSettingsObservers(): void {
    if (!Zotero.Prefs || typeof Zotero.Prefs.registerObserver !== 'function') {
        log('Prefs observer API unavailable');
        return;
    }

    unregisterSettingsObservers();

    try {
        for (const key of SETTINGS_KEYS) {
            const prefName = `${SETTINGS_PREF_BRANCH}.${String(key)}`;
            const token = Zotero.Prefs.registerObserver(prefName, () => {
                scheduleSettingsRefresh();
            }, true);
            settingsObserverTokens.push(token);
        }

        log(`Registered ${settingsObserverTokens.length} preference observers`);
    } catch (e) {
        log(`Failed to register preference observers: ${e}`);
    }
}

function unregisterSettingsObservers(): void {
    if (!Zotero.Prefs || typeof Zotero.Prefs.unregisterObserver !== 'function') {
        settingsObserverTokens.length = 0;
        return;
    }

    for (const token of settingsObserverTokens.splice(0)) {
        try {
            Zotero.Prefs.unregisterObserver(token);
        } catch {
            // ignore
        }
    }

    if (settingsRefreshTimer) {
        clearTimeout(settingsRefreshTimer);
        settingsRefreshTimer = null;
    }
}

function registerStyleSheet(): void {
    try {
        const sss = Components.classes['@mozilla.org/content/style-sheet-service;1']
            .getService(Components.interfaces.nsIStyleSheetService);
        const uri = Services.io.newURI(styleSheetURI);
        if (!sss.sheetRegistered(uri, sss.AUTHOR_SHEET)) {
            sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
            log('Stylesheet registered');
        }
    } catch (e) {
        log(`Failed to register stylesheet: ${e}`);
    }
}

function unregisterStyleSheet(): void {
    try {
        const sss = Components.classes['@mozilla.org/content/style-sheet-service;1']
            .getService(Components.interfaces.nsIStyleSheetService);
        const uri = Services.io.newURI(styleSheetURI);
        if (sss.sheetRegistered(uri, sss.AUTHOR_SHEET)) {
            sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
            log('Stylesheet unregistered');
        }
    } catch {
        // ignore
    }
}

function mountChatPanel(body: any): ChatPanel | null {
    if (!body || typeof body.appendChild !== 'function') {
        return null;
    }

    const hostBody = body as HTMLElement;
    hostBody.style.display = 'flex';
    hostBody.style.flexDirection = 'column';
    hostBody.style.alignItems = 'stretch';
    hostBody.style.justifyContent = 'stretch';
    hostBody.style.width = '100%';
    hostBody.style.minWidth = '0';
    hostBody.style.height = '100%';
    hostBody.style.maxHeight = '100%';
    hostBody.style.minHeight = '620px';
    hostBody.style.overflow = 'hidden';
    hostBody.style.boxSizing = 'border-box';
    hostBody.style.margin = '0';
    hostBody.style.padding = '0';

    const existing = panelByBody.get(hostBody);
    if (existing) {
        return existing;
    }

    const doc = hostBody.ownerDocument;

    const container = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
    container.setAttribute('id', 'zeclau-itempane-root');
    container.style.width = '100%';
    container.style.minWidth = '0';
    container.style.alignSelf = 'stretch';
    container.style.height = '100%';
    container.style.maxHeight = '100%';
    container.style.minHeight = '620px';
    container.style.flex = '1 1 auto';
    container.style.overflow = 'hidden';
    container.style.boxSizing = 'border-box';

    hostBody.textContent = '';
    hostBody.appendChild(container);

    const panel = new ChatPanel(doc, container, service, conversationManager, settings);
    panel.build();

    panelByBody.set(hostBody, panel);
    activePanels.add(panel);

    return panel;
}

function destroyChatPanel(body: any): void {
    if (!body) return;
    const hostBody = body as HTMLElement;
    const panel = panelByBody.get(hostBody);
    if (panel) {
        panel.destroy();
        activePanels.delete(panel);
        panelByBody.delete(hostBody);
    }
}

function applySectionChrome(doc: Document, setSectionSummary?: ((summary: string) => unknown) | null): void {
    try {
        if (typeof setSectionSummary === 'function') {
            // Avoid duplicate "Zoclau" text in collapsed header row.
            setSectionSummary('');
        }
    } catch {
        // ignore
    }

    const apply = (): void => {
        try {
            const header = doc.querySelector(`[data-l10n-id="${HEADER_L10N_ID}"]`) as HTMLElement | null;
            if (header) {
                header.classList.add('zeclau-pane-chrome-header');
                header.setAttribute('title', DISPLAY_NAME);
                header.setAttribute('aria-label', DISPLAY_NAME);
                // Ensure top header shows "icon + Zoclau" even when l10n string is unresolved.
                header.setAttribute('label', DISPLAY_NAME);
                header.setAttribute('value', DISPLAY_NAME);
                header.style.removeProperty('display');
                header.style.removeProperty('visibility');
                header.style.setProperty('margin-inline-start', '0', 'important');
                header.style.setProperty('margin-inline-end', 'auto', 'important');
                header.style.setProperty('text-align', 'left', 'important');
                header.style.setProperty('white-space', 'nowrap', 'important');

                const headerText = (header.textContent || '').replace(/\s+/g, ' ').trim();
                const existingFallback = header.querySelector('.zeclau-pane-header-text') as HTMLElement | null;
                if (!headerText && !existingFallback) {
                    const fallback = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
                    fallback.className = 'zeclau-pane-header-text';
                    fallback.textContent = DISPLAY_NAME;
                    header.appendChild(fallback);
                }

                const row = (header.closest('[class*="header"]') as HTMLElement | null) || header.parentElement;
                if (row) {
                    row.classList.add('zeclau-pane-header-row');
                    row.style.setProperty('display', '-moz-box', 'important');
                    row.style.setProperty('-moz-box-pack', 'start', 'important');
                    row.style.setProperty('-moz-box-align', 'center', 'important');
                    row.style.setProperty('width', '100%', 'important');
                    row.style.setProperty('box-sizing', 'border-box', 'important');
                    row.style.setProperty('padding-left', '6px', 'important');
                    row.style.setProperty('padding-right', '8px', 'important');

                    const children = Array.from(row.children) as HTMLElement[];
                    if (children.length > 1) {
                        const trailing = children[children.length - 1];
                        if (trailing && trailing !== header && !trailing.contains(header)) {
                            trailing.style.setProperty('margin-left', 'auto', 'important');
                            trailing.style.setProperty('margin-inline-start', 'auto', 'important');
                            trailing.style.setProperty('flex', '0 0 auto', 'important');
                            trailing.style.setProperty('-moz-box-flex', '0', 'important');
                        }
                    }
                }
            }

            const sidenav = doc.querySelector(`[data-l10n-id="${SIDENAV_L10N_ID}"]`) as HTMLElement | null;
            if (sidenav) {
                sidenav.classList.add('zeclau-pane-chrome-sidenav');
                sidenav.setAttribute('title', DISPLAY_NAME);
                sidenav.setAttribute('aria-label', DISPLAY_NAME);
                // Do not show duplicated text in the right-side vertical sidenav icon list.
                sidenav.removeAttribute('label');
                sidenav.removeAttribute('value');
                const existingSideFallback = sidenav.querySelector('.zeclau-pane-sidenav-text') as HTMLElement | null;
                if (existingSideFallback) {
                    existingSideFallback.remove();
                }
            }
        } catch {
            // ignore
        }
    };

    apply();
    for (const delay of [40, 120, 320, 800]) {
        try {
            doc.defaultView?.setTimeout(() => apply(), delay);
        } catch {
            // ignore
        }
    }
}

/**
 * Initialize the plugin (non-window tasks).
 * Called by bootstrap.js startup().
 */
export async function init(params: { id: string; version: string; rootURI: string }): Promise<void> {
    pluginId = params.id;
    pluginVersion = params.version;
    styleSheetURI = CONTENT_BASE_URI + 'zeclau.css';

    log(`Initializing ${DISPLAY_NAME} v${pluginVersion}`);

    // Load settings
    settings = loadSettings();

    // Auto-detect CLI path if not set
    if (!settings.claudeCliPath) {
        try {
            const detectedPath = findClaudeCli();
            if (detectedPath) {
                settings.claudeCliPath = detectedPath;
                saveSetting('claudeCliPath', detectedPath);
                log(`Auto-detected Claude CLI: ${detectedPath}`);
            }
        } catch (e) {
            log(`CLI detection failed: ${e}`);
        }
    }

    // Initialize services
    service = new ClaudeService(settings);
    conversationManager = new ConversationManager();

    registerStyleSheet();
    registerPreferencePane();
    registerItemPaneSection();
    registerSettingsObservers();

    log(`${DISPLAY_NAME} initialized successfully`);
}

/**
 * Called when Zotero's main window is loaded.
 */
export function onMainWindowLoad(_window: any): void {
    // Retry in case section registration API is late-initialized.
    registerItemPaneSection();
}

/**
 * Called when Zotero's main window is unloaded.
 */
export function onMainWindowUnload(_window: any): void {
    // Item pane sections clean themselves via onDestroy hook.
}

/**
 * Shut down the plugin.
 */
export function shutdown(): void {
    log(`Shutting down ${DISPLAY_NAME}`);

    for (const panel of activePanels) {
        panel.destroy();
    }
    activePanels.clear();

    if (sectionKey && Zotero.ItemPaneManager?.unregisterSection) {
        try {
            Zotero.ItemPaneManager.unregisterSection(sectionKey);
            log(`Unregistered item pane section: ${sectionKey}`);
        } catch (e) {
            log(`Failed to unregister item pane section: ${e}`);
        }
    }
    sectionKey = null;

    if (service) {
        service.shutdown();
    }

    unregisterSettingsObservers();
    unregisterStyleSheet();

    log(`${DISPLAY_NAME} shut down`);
}

/**
 * Register the preference pane in Zotero settings.
 */
function registerPreferencePane(): void {
    try {
        Zotero.PreferencePanes.register({
            pluginID: pluginId,
            src: CONTENT_BASE_URI + 'preferences.xhtml',
            label: DISPLAY_NAME,
            image: CONTENT_BASE_URI + 'icons/zoclau-48.png',
        });
        log(`Preference pane registered: ${CONTENT_BASE_URI}preferences.xhtml`);
    } catch (e) {
        log(`Failed to register preference pane: ${e}`);
    }
}

/**
 * Register a native Zotero right-side item pane section.
 */
function registerItemPaneSection(): void {
    if (sectionKey) {
        return;
    }

    if (!Zotero.ItemPaneManager || typeof Zotero.ItemPaneManager.registerSection !== 'function') {
        log('ItemPaneManager API unavailable');
        return;
    }

    const icon = CONTENT_BASE_URI + 'icons/zoclau-16.png';

    try {
        sectionKey = Zotero.ItemPaneManager.registerSection({
            paneID: 'zeclau-sidebar',
            pluginID: pluginId,
            header: {
                icon,
                l10nID: HEADER_L10N_ID,
            },
            sidenav: {
                icon,
                l10nID: SIDENAV_L10N_ID,
            },
            onInit: ({ body, setSectionSummary }: any) => {
                mountChatPanel(body);
                if (body?.ownerDocument) {
                    applySectionChrome(body.ownerDocument, setSectionSummary);
                }
            },
            onRender: ({ body, item, setSectionSummary }: any) => {
                const panel = mountChatPanel(body);
                panel?.onItemChange(item);
                if (body?.ownerDocument) {
                    applySectionChrome(body.ownerDocument, setSectionSummary);
                }
            },
            onItemChange: ({ body, item, setEnabled, setSectionSummary }: any) => {
                try {
                    if (typeof setEnabled === 'function') {
                        setEnabled(true);
                    }
                } catch {
                    // ignore
                }
                const panel = mountChatPanel(body);
                panel?.onItemChange(item);
                if (body?.ownerDocument) {
                    applySectionChrome(body.ownerDocument, setSectionSummary);
                }
            },
            onDestroy: ({ body }: any) => {
                destroyChatPanel(body);
            },
        });

        if (!sectionKey) {
            log('Failed to register item pane section');
            return;
        }

        log(`Registered item pane section: ${sectionKey}`);
    } catch (e) {
        log(`Error registering item pane section: ${e}`);
    }
}


























