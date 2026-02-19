/**
 * Preference helpers for Zoclau.
 * Uses Zotero.Prefs to read/write preferences with compatibility fallbacks.
 */

import type { ZoclauSettings, ConversationMeta, ChatMessage } from './types';
import { DEFAULT_SETTINGS } from './types';

declare const Zotero: any;

const PREF_PREFIX = 'extensions.zotero.zoclau';
const LEGACY_PREF_PREFIXES: Array<{ prefix: string; global: boolean }> = [
    { prefix: 'extensions.zotero.zeclau', global: true },
    { prefix: 'zoclau', global: false },
    { prefix: 'zeclau', global: false },
];

function getPref(key: string): any {
    try {
        const fullKey = `${PREF_PREFIX}.${key}`;
        const direct = Zotero.Prefs.get(fullKey, true);
        if (direct !== undefined) {
            return direct;
        }

        for (const legacy of LEGACY_PREF_PREFIXES) {
            const legacyKey = `${legacy.prefix}.${key}`;
            const legacyValue = legacy.global
                ? Zotero.Prefs.get(legacyKey, true)
                : Zotero.Prefs.get(legacyKey);
            if (legacyValue !== undefined) {
                return legacyValue;
            }
        }
    } catch {
        // ignore and fall through
    }
    return undefined;
}

function setPref(key: string, value: any): void {
    try {
        Zotero.Prefs.set(`${PREF_PREFIX}.${key}`, value, true);
        // Keep legacy branches in sync for downgrade compatibility.
        for (const legacy of LEGACY_PREF_PREFIXES) {
            const legacyKey = `${legacy.prefix}.${key}`;
            if (legacy.global) {
                Zotero.Prefs.set(legacyKey, value, true);
            } else {
                Zotero.Prefs.set(legacyKey, value);
            }
        }
    } catch (e) {
        Zotero.debug(`[Zoclau] Failed to set pref ${key}: ${e}`);
    }
}

function toStringPref(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function toBooleanPref(value: unknown, fallback: boolean): boolean {
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

export function loadSettings(): ZoclauSettings {
    return {
        userName: toStringPref(getPref('userName'), DEFAULT_SETTINGS.userName),
        model: toStringPref(getPref('model'), DEFAULT_SETTINGS.model),
        thinkingBudget: toStringPref(getPref('thinkingBudget'), DEFAULT_SETTINGS.thinkingBudget) as ZoclauSettings['thinkingBudget'],
        systemPrompt: toStringPref(getPref('systemPrompt'), DEFAULT_SETTINGS.systemPrompt),
        environmentVariables: toStringPref(getPref('environmentVariables'), DEFAULT_SETTINGS.environmentVariables),
        claudeCliPath: toStringPref(getPref('claudeCliPath'), DEFAULT_SETTINGS.claudeCliPath),
        workingDirectory: toStringPref(getPref('workingDirectory'), DEFAULT_SETTINGS.workingDirectory),
        permissionMode: toStringPref(getPref('permissionMode'), DEFAULT_SETTINGS.permissionMode) as ZoclauSettings['permissionMode'],
        enableAutoScroll: toBooleanPref(getPref('enableAutoScroll'), DEFAULT_SETTINGS.enableAutoScroll),
        loadUserClaudeSettings: toBooleanPref(getPref('loadUserClaudeSettings'), DEFAULT_SETTINGS.loadUserClaudeSettings),
        blockedCommandsWindows: toStringPref(getPref('blockedCommandsWindows'), DEFAULT_SETTINGS.blockedCommandsWindows),
        blockedCommandsUnix: toStringPref(getPref('blockedCommandsUnix'), DEFAULT_SETTINGS.blockedCommandsUnix),
    };
}

export function saveSetting<K extends keyof ZoclauSettings>(
    key: K,
    value: ZoclauSettings[K]
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
