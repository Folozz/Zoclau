/**
 * ConversationManager - Manages conversation CRUD operations.
 */

import type { ConversationMeta, ChatMessage } from '../settings/types';
import { loadConversations, saveConversations } from '../settings/prefs';

declare const Zotero: any;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_SHORT_MS = 30 * ONE_DAY_MS;
const RETENTION_LONG_MS = 90 * ONE_DAY_MS;
const STORAGE_THRESHOLD_BYTES = 96 * 1024;

export class ConversationManager {
    private conversations: ConversationMeta[] = [];
    private messages: Map<string, ChatMessage[]> = new Map();
    private activeConversationId: string | null = null;

    constructor() {
        this.load();
    }

    /** Load conversations from storage */
    load(): void {
        this.conversations = this.normalizeConversations(loadConversations());
        const pruned = this.pruneExpiredConversations();
        if (pruned) {
            this.save();
        }
    }

    /** Save conversations to storage */
    save(): void {
        this.pruneExpiredConversations();
        saveConversations(this.conversations);
    }

    /** Get all conversations */
    getAll(): ConversationMeta[] {
        return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** Get the active conversation */
    getActive(): ConversationMeta | null {
        if (!this.activeConversationId) return null;
        return this.conversations.find((c) => c.id === this.activeConversationId) || null;
    }

    /** Get the active conversation ID */
    getActiveId(): string | null {
        return this.activeConversationId;
    }

    /** Get messages for a conversation */
    getMessages(conversationId: string): ChatMessage[] {
        return this.messages.get(conversationId) || [];
    }

    /** Get messages for the active conversation */
    getActiveMessages(): ChatMessage[] {
        if (!this.activeConversationId) return [];
        return this.getMessages(this.activeConversationId);
    }

    /** Create a new conversation */
    create(title?: string): ConversationMeta {
        const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const conv: ConversationMeta = {
            id,
            title: title || this.generateDefaultTitle(),
            createdAt: now,
            updatedAt: now,
        };
        this.conversations.unshift(conv);
        this.messages.set(id, []);
        this.activeConversationId = id;
        this.save();
        return conv;
    }

    /** Switch to a conversation */
    switchTo(conversationId: string): boolean {
        const conv = this.conversations.find((c) => c.id === conversationId);
        if (!conv) return false;
        this.activeConversationId = conversationId;
        return true;
    }

    /** Delete a conversation */
    delete(conversationId: string): void {
        this.conversations = this.conversations.filter((c) => c.id !== conversationId);
        this.messages.delete(conversationId);
        if (this.activeConversationId === conversationId) {
            this.activeConversationId = this.conversations[0]?.id || null;
        }
        this.save();
    }

    /** Add a message to a conversation */
    addMessage(conversationId: string, message: ChatMessage): void {
        if (!this.messages.has(conversationId)) {
            this.messages.set(conversationId, []);
        }
        this.messages.get(conversationId)!.push(message);

        // Update conversation timestamp
        const conv = this.conversations.find((c) => c.id === conversationId);
        if (conv) {
            conv.updatedAt = Date.now();
            this.save();
        }
    }

    /** Update conversation title */
    updateTitle(conversationId: string, title: string): void {
        const conv = this.conversations.find((c) => c.id === conversationId);
        if (conv) {
            conv.title = title;
            this.save();
        }
    }

    /** Generate a default conversation title */
    private generateDefaultTitle(): string {
        return '新会话';
    }

    private isLegacyAutoTitle(title: string): boolean {
        const normalized = (title || '').trim();
        if (!normalized) return true;

        const lower = normalized.toLowerCase();
        if (lower === 'chat' || lower.startsWith('chat ')) return true;
        if (normalized === '会话' || normalized === '新会话') return true;
        if (/^会话\s*\d*$/.test(normalized)) return true;
        if (/^\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?$/.test(normalized)) return true;
        return false;
    }

    private normalizeConversations(input: ConversationMeta[]): ConversationMeta[] {
        const out: ConversationMeta[] = [];
        const now = Date.now();

        for (const conv of input || []) {
            const id = typeof conv?.id === 'string' ? conv.id : '';
            if (!id) continue;

            const rawTitle = typeof conv?.title === 'string' && conv.title.trim()
                ? conv.title.trim()
                : this.generateDefaultTitle();
            const title = this.isLegacyAutoTitle(rawTitle)
                ? this.generateDefaultTitle()
                : rawTitle;

            const createdAt = typeof conv?.createdAt === 'number' && Number.isFinite(conv.createdAt)
                ? conv.createdAt
                : now;

            const updatedAt = typeof conv?.updatedAt === 'number' && Number.isFinite(conv.updatedAt)
                ? conv.updatedAt
                : createdAt;

            out.push({
                id,
                title,
                createdAt,
                updatedAt,
                sessionId: typeof conv?.sessionId === 'string' ? conv.sessionId : undefined,
            });
        }

        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private estimateConversationBytes(): number {
        try {
            return JSON.stringify(this.conversations).length * 2;
        } catch {
            return 0;
        }
    }

    private getRetentionMs(): number {
        const bytes = this.estimateConversationBytes();
        return bytes > STORAGE_THRESHOLD_BYTES ? RETENTION_SHORT_MS : RETENTION_LONG_MS;
    }

    private pruneExpiredConversations(): boolean {
        if (this.conversations.length === 0) return false;

        const retentionMs = this.getRetentionMs();
        const cutoff = Date.now() - retentionMs;
        const beforeLen = this.conversations.length;

        this.conversations = this.conversations.filter((conv) => {
            const stamp = Math.max(conv.updatedAt || 0, conv.createdAt || 0);
            return stamp >= cutoff;
        });

        const keepIds = new Set(this.conversations.map((conv) => conv.id));

        for (const id of Array.from(this.messages.keys())) {
            if (!keepIds.has(id)) {
                this.messages.delete(id);
            }
        }

        if (this.activeConversationId && !keepIds.has(this.activeConversationId)) {
            this.activeConversationId = this.conversations[0]?.id || null;
        }

        const changed = beforeLen !== this.conversations.length;
        if (changed) {
            try {
                const days = Math.round(retentionMs / ONE_DAY_MS);
                Zotero.debug(`[Zoclau] Pruned ${beforeLen - this.conversations.length} expired conversations (retention ${days} days).`);
            } catch {
                // ignore debug failures
            }
        }

        return changed;
    }

    /** Clear all data */
    clear(): void {
        this.conversations = [];
        this.messages.clear();
        this.activeConversationId = null;
        this.save();
    }
}

