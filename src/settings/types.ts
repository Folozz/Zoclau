/**
 * Zoclau settings type definitions.
 */

export type ClaudeModel = 'auto' | 'haiku' | 'sonnet' | 'sonnet-1m' | 'opus' | string;
export type ThinkingBudget = 'off' | 'low' | 'medium' | 'high' | 'max';
export type PermissionMode = 'yolo' | 'plan' | 'normal';

export interface ZeClauSettings {
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

export const DEFAULT_SETTINGS: ZeClauSettings = {
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
    /** Content blocks from SDK streaming */
    contentBlocks?: ContentBlock[];
    /** Whether this message is still streaming */
    isStreaming?: boolean;
}

/** Content block types for assistant messages */
export interface TextBlock {
    type: 'text';
    text: string;
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

export interface ThinkingBlock {
    type: 'thinking';
    thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

/** Stream chunk from the Claude Agent SDK */
export interface StreamChunk {
    type: string;
    [key: string]: unknown;
}

/** Response handler for routing stream chunks */
export interface ResponseHandler {
    readonly id: string;
    onChunk: (chunk: StreamChunk) => void;
    onDone: () => void;
    onError: (error: Error) => void;
    readonly sawStreamText: boolean;
    readonly sawAnyChunk: boolean;
    markStreamTextSeen(): void;
    resetStreamText(): void;
    markChunkSeen(): void;
}

export function createResponseHandler(options: {
    id: string;
    onChunk: (chunk: StreamChunk) => void;
    onDone: () => void;
    onError: (error: Error) => void;
}): ResponseHandler {
    let _sawStreamText = false;
    let _sawAnyChunk = false;

    return {
        id: options.id,
        onChunk: options.onChunk,
        onDone: options.onDone,
        onError: options.onError,
        get sawStreamText() { return _sawStreamText; },
        get sawAnyChunk() { return _sawAnyChunk; },
        markStreamTextSeen() { _sawStreamText = true; },
        resetStreamText() { _sawStreamText = false; },
        markChunkSeen() { _sawAnyChunk = true; },
    };
}

/**
 * Model ID mapping for the Claude Agent SDK.
 */
export const MODEL_MAP: Record<string, string> = {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-4-5',
    'sonnet-1m': 'claude-sonnet-4-5',
    opus: 'claude-opus-4',
};

export const THINKING_BUDGET_MAP: Record<ThinkingBudget, number | null> = {
    off: null,
    low: 1024,
    medium: 4096,
    high: 10240,
    max: 32768,
};


