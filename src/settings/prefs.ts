/**
 * Preference helpers for Zoclau.
 * Uses Zotero.Prefs to read/write preferences with compatibility fallbacks.
 */

import type { ZeClauSettings, ConversationMeta, ChatMessage } from './types';
import { DEFAULT_SETTINGS } from './types';

declare const Zotero: any;

const PREF_PREFIX = 'extensions.zotero.zeclau';
const LEGACY_PREF_PREFIX = 'zeclau';

function getPref(key: string): any {
    try {
        const fullKey = `${PREF_PREFIX}.${key}`;
        const direct = Zotero.Prefs.get(fullKey, true);
        if (direct !== undefined) {
            return direct;
        }

        // Compatibility fallback for older branch access.
        return Zotero.Prefs.get(`${LEGACY_PREF_PREFIX}.${key}`);
    } catch {
        return undefined;
    }
}

function setPref(key: string, value: any): void {
    try {
        Zotero.Prefs.set(`${PREF_PREFIX}.${key}`, value, true);
        // Compatibility write to non-global branch variant.
        Zotero.Prefs.set(`${LEGACY_PREF_PREFIX}.${key}`, value);
    } catch (e) {
        Zotero.debug(`[Zoclau] Failed to set pref ${key}: ${e}`);
    }
}

export function loadSettings(): ZeClauSettings {
    return {
        userName: getPref('userName') ?? DEFAULT_SETTINGS.userName,
        model: getPref('model') ?? DEFAULT_SETTINGS.model,
        thinkingBudget: getPref('thinkingBudget') ?? DEFAULT_SETTINGS.thinkingBudget,
        systemPrompt: getPref('systemPrompt') ?? DEFAULT_SETTINGS.systemPrompt,
        environmentVariables: getPref('environmentVariables') ?? DEFAULT_SETTINGS.environmentVariables,
        claudeCliPath: getPref('claudeCliPath') ?? DEFAULT_SETTINGS.claudeCliPath,
        workingDirectory: getPref('workingDirectory') ?? DEFAULT_SETTINGS.workingDirectory,
        permissionMode: getPref('permissionMode') ?? DEFAULT_SETTINGS.permissionMode,
        enableAutoScroll: getPref('enableAutoScroll') ?? DEFAULT_SETTINGS.enableAutoScroll,
        enableBlocklist: getPref('enableBlocklist') ?? DEFAULT_SETTINGS.enableBlocklist,
    };
}

export function saveSettings(settings: ZeClauSettings): void {
    for (const [key, value] of Object.entries(settings)) {
        setPref(key, value);
    }
}

export function saveSetting<K extends keyof ZeClauSettings>(
    key: K,
    value: ZeClauSettings[K]
): void {
    setPref(key, value);
}

export function loadConversations(): ConversationMeta[] {
    try {
        const raw = getPref('conversations');
        if (typeof raw === 'string' && raw.length > 0) {
            return JSON.parse(raw);
        }
    } catch (e) {
        Zotero.debug(`[Zoclau] Failed to load conversations: ${e}`);
    }
    return [];
}

export function saveConversations(conversations: ConversationMeta[]): void {
    setPref('conversations', JSON.stringify(conversations));
}

export function loadMessages(): Record<string, ChatMessage[]> {
    try {
        const raw = getPref('messages');
        if (typeof raw === 'string' && raw.length > 0) {
            return JSON.parse(raw);
        }
    } catch (e) {
        Zotero.debug(`[Zoclau] Failed to load messages: ${e}`);
    }
    return {};
}

export function saveMessages(messages: Record<string, ChatMessage[]>): void {
    setPref('messages', JSON.stringify(messages));
}
