/**
 * Zoclau settings type definitions.
 */

export type ClaudeModel = 'auto' | 'haiku' | 'sonnet' | 'sonnet-1m' | 'opus' | string;
export type ThinkingBudget = 'off' | 'low' | 'medium' | 'high' | 'max';
export type PermissionMode = 'yolo' | 'plan' | 'normal';

export interface ZoclauSettings {
    userName: string;
    model: ClaudeModel;
    thinkingBudget: ThinkingBudget;
    systemPrompt: string;
    environmentVariables: string;
    claudeCliPath: string;
    workingDirectory: string;
    permissionMode: PermissionMode;
    enableAutoScroll: boolean;
    enableBlocklist: boolean;
}

export const DEFAULT_SETTINGS: ZoclauSettings = {
    userName: '',
    model: 'auto',
    thinkingBudget: 'off',
    systemPrompt: '',
    environmentVariables: '',
    claudeCliPath: '',
    workingDirectory: '',
    permissionMode: 'yolo',
    enableAutoScroll: true,
    enableBlocklist: true,
};

/** Conversation metadata */
export interface ConversationMeta {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    sessionId?: string;
}

/** Chat message */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    /** Whether this message is still streaming */
    isStreaming?: boolean;
}

export interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: string;
}

export interface ToolResultBlock {
    type: 'tool_result';
    toolUseId: string;
    content: string;
    isError?: boolean;
}

export const THINKING_BUDGET_MAP: Record<ThinkingBudget, number | null> = {
    off: null,
    low: 1024,
    medium: 4096,
    high: 10240,
    max: 32768,
};
