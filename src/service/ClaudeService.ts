/**
 * ClaudeService - Claude Agent SDK wrapper for Zoclau.
 *
 * Uses Zotero's Subprocess API (Mozilla nsIProcess) instead of Node.js
 * child_process, since Zotero runs in a Firefox context.
 */

import type {
    ZoclauSettings,
    ChatMessage,
    ToolUseBlock,
    ToolResultBlock,
} from '../settings/types';
import { THINKING_BUDGET_MAP } from '../settings/types';
import { parseEnvironmentVariables } from '../utils/env';

declare const Zotero: any;
declare const Components: any;
declare const ChromeUtils: any;
declare const Services: any;

function log(msg: string): void {
    const text = `[Zoclau:Service] ${msg}`;
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

interface StreamState {
    conversationId: string;
    sawTextDelta: boolean;
}

/**
 * ClaudeService manages communication with the Claude CLI.
 * Uses Mozilla's nsIProcess for spawning the CLI process.
 */
export class ClaudeService {
    private settings: ZoclauSettings;
    private sessionByConversation = new Map<string, string>();
    private isRunning = false;
    private currentProcess: any = null;
    private abortRequested = false;

    // Callbacks
    private onMessageCallback: ((msg: ChatMessage) => void) | null = null;
    private onStreamCallback: ((text: string, messageId: string) => void) | null = null;
    private onToolUseCallback: ((block: ToolUseBlock) => void) | null = null;
    private onToolResultCallback: ((block: ToolResultBlock) => void) | null = null;
    private onErrorCallback: ((error: Error) => void) | null = null;
    private onStreamStartCallback: (() => void) | null = null;
    private onStreamEndCallback: (() => void) | null = null;

    constructor(settings: ZoclauSettings) {
        this.settings = settings;
    }

    updateSettings(settings: ZoclauSettings): void {
        this.settings = settings;
    }

    onMessage(cb: (msg: ChatMessage) => void): void { this.onMessageCallback = cb; }
    onStream(cb: (text: string, messageId: string) => void): void { this.onStreamCallback = cb; }
    onToolUse(cb: (block: ToolUseBlock) => void): void { this.onToolUseCallback = cb; }
    onToolResult(cb: (block: ToolResultBlock) => void): void { this.onToolResultCallback = cb; }
    onError(cb: (error: Error) => void): void { this.onErrorCallback = cb; }
    onStreamStart(cb: () => void): void { this.onStreamStartCallback = cb; }
    onStreamEnd(cb: () => void): void { this.onStreamEndCallback = cb; }

    getCliPath(): string {
        return this.settings.claudeCliPath || 'claude';
    }

    getWorkingDirectory(): string {
        if (this.settings.workingDirectory) {
            return this.settings.workingDirectory;
        }
        try {
            return Zotero.DataDirectory.dir || Zotero.Profile?.dir || '';
        } catch {
            return '';
        }
    }

    getModelId(): string {
        const raw = (this.settings.model || '').toString().trim();
        return raw || 'auto';
    }

    getThinkingBudget(): number | null {
        return THINKING_BUDGET_MAP[this.settings.thinkingBudget] ?? null;
    }

    get busy(): boolean {
        return this.isRunning;
    }

    private buildSystemPrompt(skillPrompt?: string): string {
        const parts: string[] = [];
        parts.push(
            'You are Claude, an AI assistant embedded in Zotero (a reference management tool). ' +
            'You help the user with their research, writing, and reference management tasks. ' +
            'You have full agentic capabilities: file read/write, search, and bash commands.'
        );
        if (this.settings.userName) {
            parts.push(`The user's name is ${this.settings.userName}.`);
        }
        if (this.settings.systemPrompt) {
            parts.push(this.settings.systemPrompt);
        }
        if (skillPrompt) {
            parts.push(`# Skill Instructions\nFollow these instructions precisely:\n\n${skillPrompt}`);
        }
        return parts.join('\n\n');
    }

    /**
     * Send a message to Claude using Mozilla's Subprocess API.
     */
    async sendMessage(userMessage: string, conversationId: string, skillPrompt?: string): Promise<void> {
        if (this.isRunning) {
            log('Already processing a message, skipping');
            return;
        }

        this.abortRequested = false;
        this.isRunning = true;
        this.onStreamStartCallback?.();
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let fullResponse = '';
        let stderrOutput = '';
        let sawStructuredEvent = false;
        let lastActivityAt = Date.now();

        try {
            const cliPath = this.getCliPath();
            const model = this.getModelId();
            const gitBashPath = this.ensureGitBashEnvironment();
            log(`Sending message via CLI: ${cliPath}, model: ${model}${gitBashPath ? `, git-bash: ${gitBashPath}` : ''}`);

            // Build arguments (Claudian-style: keep model alias as-is for provider compatibility).
            const args: string[] = [
                '--print',
                '--verbose',
                '--output-format', 'stream-json',
                '--input-format', 'text',
                '--include-partial-messages',
            ];

            if (model && model !== 'auto') {
                args.push('--model', model);
            }

            const resumeSessionId = this.sessionByConversation.get(conversationId) || '';
            if (resumeSessionId && this.isValidUuid(resumeSessionId)) {
                args.push('--resume', resumeSessionId);
            }
            this.applyRuntimeEnvironment(gitBashPath);
            args.push('--setting-sources', 'user,project');

            const systemPrompt = this.buildSystemPrompt(skillPrompt);
            if (systemPrompt) {
                args.push('--system-prompt', systemPrompt);
            }

            this.appendPermissionModeArgs(args);

            const thinkingBudget = this.getThinkingBudget();
            if (thinkingBudget !== null) {
                // Compatibility: some Claude CLI versions do not support thinking token flags.
                log(`Thinking budget requested (${thinkingBudget}) but CLI compatibility mode skips explicit token flags.`);
            }
            log(`CLI args: ${args.join(' ')}`);

            // Use Zotero.Utilities.Internal.subprocess or Subprocess module
            let Subprocess: any;
            try {
                // Zotero 7 provides Subprocess via ChromeUtils
                Subprocess = ChromeUtils.importESModule
                    ? ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs')
                    : ChromeUtils.import('resource://gre/modules/Subprocess.jsm');
                if (Subprocess.Subprocess) Subprocess = Subprocess.Subprocess;
            } catch (e) {
                log(`Subprocess module not available: ${e}`);
                throw new Error('Subprocess API not available. Please ensure Claude CLI path is set correctly.');
            }

            // Resolve CLI path to nsIFile
            const cliFile = Components.classes['@mozilla.org/file/local;1']
                .createInstance(Components.interfaces.nsIFile);

            // Handle relative paths - search in PATH
            if (cliPath.includes('/') || cliPath.includes('\\')) {
                cliFile.initWithPath(cliPath);
            } else {
                // Need to find in PATH
                const env = Components.classes['@mozilla.org/process/environment;1']
                    .getService(Components.interfaces.nsIEnvironment);
                const pathVar = env.get('PATH') || '';
                const sep = pathVar.includes(';') ? ';' : ':';
                const ext = pathVar.includes(';') ? ['.exe', '.cmd', '.bat', ''] : [''];
                let found = false;

                for (const dir of pathVar.split(sep)) {
                    if (!dir) continue;
                    for (const suffix of ext) {
                        try {
                            const testPath = dir + (dir.endsWith('/') || dir.endsWith('\\') ? '' : '/') + cliPath + suffix;
                            const testFile = Components.classes['@mozilla.org/file/local;1']
                                .createInstance(Components.interfaces.nsIFile);
                            testFile.initWithPath(testPath.replace(/\//g, '\\'));
                            if (testFile.exists()) {
                                cliFile.initWithPath(testFile.path);
                                found = true;
                                break;
                            }
                        } catch {
                            // invalid path
                        }
                    }
                    if (found) break;
                }

                if (!found) {
                    throw new Error(`Could not find Claude CLI '${cliPath}' in PATH. Please set the full path in settings.`);
                }
            }

            log(`Resolved CLI path: ${cliFile.path}`);

            // Spawn subprocess
            const proc = await Subprocess.call({
                command: cliFile.path,
                arguments: args,
                workdir: this.getWorkingDirectory() || undefined,
                stdin: 'pipe',
                stderr: 'pipe',
            });

            this.currentProcess = proc;

            if (!proc.stdin) {
                throw new Error('Claude CLI process stdin is not available.');
            }

            try {
                await proc.stdin.write(userMessage);
                await proc.stdin.close();
                lastActivityAt = Date.now();
                log(`Prompt sent via stdin (${userMessage.length} chars)`);
            } catch (e) {
                throw new Error(`Failed to write prompt to Claude CLI stdin: ${e}`);
            }

            const appendStreamingText = (text: string): void => {
                if (!text) return;
                fullResponse += text;
                this.onStreamCallback?.(fullResponse, messageId);
            };

            const streamState: StreamState = {
                conversationId,
                sawTextDelta: false,
            };

            const processOutputLine = (line: string): void => {
                const normalized = this.normalizeOutputLine(line);
                if (!normalized) return;

                try {
                    const event = JSON.parse(normalized);
                    sawStructuredEvent = true;
                    this.handleStreamEvent(event, messageId, appendStreamingText, streamState);
                } catch {
                    appendStreamingText(normalized + '\n');
                    lastActivityAt = Date.now();
                }
            };

            // Read stdout in chunks (best-effort, do not block process completion)
            let buffer = '';
            const readLoop = async () => {
                try {
                    while (true) {
                        const data = await proc.stdout.readString();
                        if (!data) break; // EOF

                        lastActivityAt = Date.now();
                        buffer += data;
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            processOutputLine(line);
                        }
                    }
                } catch (e) {
                    if (!this.abortRequested) {
                        log(`Read error: ${e}`);
                    }
                }
            };

            const readStderrLoop = async () => {
                try {
                    while (true) {
                        const data = await proc.stderr.readString();
                        if (!data) break; // EOF
                        lastActivityAt = Date.now();
                        stderrOutput += data;
                        try {
                            const trimmed = data.trim();
                            if (trimmed) {
                                log(`CLI stderr: ${trimmed.slice(0, 400)}`);
                            }
                        } catch {
                            // ignore
                        }
                    }
                } catch (e) {
                    if (!this.abortRequested) {
                        log(`Stderr read error: ${e}`);
                    }
                }
            };

            const stdoutPromise = readLoop();
            const stderrPromise = readStderrLoop();

            // Wait for process exit first; pipe draining must not block forever.
            const inactivityLimitMs = 180000;
            const waitResult: any = await Promise.race([
                proc.wait().then((result: any) => ({ timeout: false, exitCode: result.exitCode })),
                new Promise<{ timeout: boolean }>((resolve) => {
                    const check = setInterval(() => {
                        if (Date.now() - lastActivityAt > inactivityLimitMs) {
                            clearInterval(check);
                            resolve({ timeout: true });
                        }
                    }, 5000);
                    proc.wait().then(() => clearInterval(check)).catch(() => clearInterval(check));
                }),
            ]);

            if (waitResult.timeout) {
                try {
                    proc.kill();
                } catch {
                    // ignore
                }
                const idleSeconds = Math.floor((Date.now() - lastActivityAt) / 1000);
                throw new Error(`Claude CLI timed out after ${idleSeconds}s of inactivity.`);
            }

            const exitCode = Number(waitResult.exitCode ?? -1);
            log(`CLI exited with code ${exitCode}`);

            await this.waitForPromiseWithTimeout(Promise.all([stdoutPromise, stderrPromise]), 1200);

            // Process remaining buffer
            if (buffer.trim()) {
                processOutputLine(buffer);
            }

            const stderrText = stderrOutput.trim();

            if (this.abortRequested) {
                log('Claude request aborted by user');
                return;
            }

            if (exitCode === -9) {
                throw new Error(this.formatCliExitError(exitCode, stderrText));
            }

            if (exitCode !== 0) {
                throw new Error(this.formatCliExitError(exitCode, stderrText));
            }

            if (!fullResponse.trim()) {
                const details = stderrText ? ` Details: ${stderrText}` : '';
                const streamHint = sawStructuredEvent
                    ? 'Received stream events but no assistant text.'
                    : 'No structured stream output was received.';
                throw new Error(
                    `Claude CLI returned an empty reply. ${streamHint}${details} ` +
                    'Please verify Claude CLI login and run a quick prompt in terminal.'
                );
            }

            // Create final message
            if (fullResponse) {
                const assistantMessage: ChatMessage = {
                    id: messageId,
                    role: 'assistant',
                    content: fullResponse,
                    timestamp: Date.now(),
                    isStreaming: false,
                };
                this.onMessageCallback?.(assistantMessage);
            }
        } catch (error) {
            if (this.abortRequested) {
                log('Claude request aborted during sendMessage');
                return;
            }
            const err = error instanceof Error ? error : new Error(String(error));
            log(`Error: ${err.message}`);
            this.onErrorCallback?.(err);
        } finally {
            this.isRunning = false;
            this.currentProcess = null;
            this.abortRequested = false;
            this.onStreamEndCallback?.();
        }
    }

    private handleStreamEvent(
        event: any,
        messageId: string,
        appendText: (text: string) => void,
        streamState: StreamState,
    ): void {
        void messageId;

        if (!event) return;

        if (event.type === 'stream_event' && event.event) {
            this.handleStreamEvent(event.event, messageId, appendText, streamState);
            return;
        }

        if (typeof event.session_id === 'string' && event.session_id) {
            const sessionId = event.session_id;
            const previous = this.sessionByConversation.get(streamState.conversationId);
            if (sessionId !== previous) {
                this.sessionByConversation.set(streamState.conversationId, sessionId);
                log(`Session ID: ${sessionId}`);
            }
        }

        if (!event.type) {
            const fallback = this.extractTextValue(event);
            if (fallback) {
                appendText(fallback);
            }
            return;
        }

        switch (event.type) {
            case 'assistant':
                this.handleAssistantMessage(event, appendText, streamState.sawTextDelta);
                break;

            case 'user':
                this.handleUserMessage(event);
                break;

            case 'system':
                break;

            case 'content_block_start': {
                const block = event.content_block;
                // stream-json usually sends text in content_block_delta; avoid duplicate text.
                if (block?.type === 'tool_use') {
                    this.onToolUseCallback?.({
                        type: 'tool_use',
                        id: String(block.id || ''),
                        name: String(block.name || ''),
                        input: this.stringifyUnknown(block.input),
                    });
                }
                break;
            }

            case 'content_block_delta': {
                const delta = event.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                    streamState.sawTextDelta = true;
                    appendText(String(delta.text));
                }
                break;
            }

            case 'result':
                if (!streamState.sawTextDelta) {
                    if (typeof event.result === 'string' && event.result.trim().length > 0) {
                        appendText(event.result);
                    } else if (event.result && typeof event.result === 'object') {
                        const nested = this.extractTextValue(event.result);
                        if (nested) {
                            appendText(nested);
                        }
                    }
                }
                break;

            case 'tool_use':
                this.onToolUseCallback?.({
                    type: 'tool_use',
                    id: String(event.id || ''),
                    name: String(event.name || ''),
                    input: this.stringifyUnknown(event.input),
                });
                break;

            case 'tool_result':
                this.onToolResultCallback?.({
                    type: 'tool_result',
                    toolUseId: String(event.tool_use_id || event.toolUseId || ''),
                    content: this.extractToolResultContent(event.content),
                    isError: event.is_error === true || event.isError === true,
                });
                break;

            case 'error':
                throw new Error(this.extractErrorMessage(event));

            default: {
                const fallback = this.extractTextValue(event);
                if (fallback) {
                    appendText(fallback);
                }
                break;
            }
        }
    }

    private normalizeOutputLine(line: string): string | null {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (trimmed === '[DONE]') return null;
        if (trimmed.startsWith('event:')) return null;
        if (trimmed.startsWith(':')) return null;
        if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            return data || null;
        }
        return trimmed;
    }

    private handleAssistantMessage(event: any, appendText: (text: string) => void, skipText = false): void {
        const message = event.message;
        if (!message) return;

        if (Array.isArray(message.content)) {
            for (const block of message.content) {
                if (!block || typeof block !== 'object') continue;

                if (!skipText && block.type === 'text' && block.text) {
                    appendText(String(block.text));
                    continue;
                }

                if (block.type === 'tool_use') {
                    this.onToolUseCallback?.({
                        type: 'tool_use',
                        id: String(block.id || ''),
                        name: String(block.name || ''),
                        input: this.stringifyUnknown(block.input),
                    });
                    continue;
                }

                if (block.type === 'tool_result') {
                    this.onToolResultCallback?.({
                        type: 'tool_result',
                        toolUseId: String(block.tool_use_id || block.toolUseId || ''),
                        content: this.extractToolResultContent(block.content),
                        isError: block.is_error === true || block.isError === true,
                    });
                }
            }
            return;
        }

        if (!skipText) {
            const fallback = this.extractTextValue(message.content ?? message);
            if (fallback) {
                appendText(fallback);
            }
        }
    }

    private handleUserMessage(event: any): void {
        const message = event.message;
        if (!message || !Array.isArray(message.content)) return;

        for (const block of message.content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type !== 'tool_result') continue;

            this.onToolResultCallback?.({
                type: 'tool_result',
                toolUseId: String(block.tool_use_id || block.toolUseId || ''),
                content: this.extractToolResultContent(block.content),
                isError: block.is_error === true || block.isError === true,
            });
        }
    }

    private extractTextValue(value: any): string | null {
        if (typeof value === 'string') {
            return value;
        }

        if (!value || typeof value !== 'object') {
            return null;
        }

        if (typeof value.text === 'string' && value.text.trim().length > 0) {
            return value.text;
        }

        if (typeof value.result === 'string' && value.result.trim().length > 0) {
            return value.result;
        }

        if (typeof value.content === 'string' && value.content.trim().length > 0) {
            return value.content;
        }

        if (Array.isArray(value.content)) {
            const textParts: string[] = [];
            for (const block of value.content) {
                if (!block || typeof block !== 'object') continue;
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                    textParts.push(block.text);
                } else if (typeof block.text === 'string' && block.text.trim().length > 0) {
                    textParts.push(block.text);
                }
            }
            if (textParts.length > 0) {
                return textParts.join('\n');
            }
        }

        return null;
    }

    private stringifyUnknown(value: unknown): string {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    private extractToolResultContent(content: unknown): string {
        if (typeof content === 'string') {
            return content;
        }

        if (Array.isArray(content)) {
            const textParts: string[] = [];
            for (const entry of content) {
                if (!entry || typeof entry !== 'object') continue;
                if (entry.type === 'text' && typeof entry.text === 'string') {
                    textParts.push(entry.text);
                } else {
                    textParts.push(this.stringifyUnknown(entry));
                }
            }
            return textParts.join('\n').trim();
        }

        return this.stringifyUnknown(content);
    }

    private extractErrorMessage(event: any): string {
        if (typeof event.error === 'string' && event.error.trim().length > 0) {
            return `Claude CLI error: ${event.error}`;
        }

        if (event.error && typeof event.error === 'object') {
            const message = typeof event.error.message === 'string' ? event.error.message : this.stringifyUnknown(event.error);
            return `Claude CLI error: ${message}`;
        }

        if (typeof event.message === 'string' && event.message.trim().length > 0) {
            return `Claude CLI error: ${event.message}`;
        }

        return `Claude CLI error: ${this.stringifyUnknown(event)}`;
    }

    private appendPermissionModeArgs(args: string[]): void {
        const mode = String(this.settings.permissionMode || 'yolo');

        if (mode === 'plan') {
            args.push('--permission-mode', 'plan');
            return;
        }

        if (mode === 'normal') {
            args.push('--permission-mode', 'acceptEdits');
            return;
        }

        args.push('--permission-mode', 'bypassPermissions');
        args.push('--dangerously-skip-permissions');
    }

    private ensureGitBashEnvironment(): string | null {
        const env = this.getWindowsProcessEnvironment();
        if (!env) return null;

        const existing = this.normalizeGitBashPath(env.get('CLAUDE_CODE_GIT_BASH_PATH') || '');
        if (existing && this.fileExists(existing)) {
            return existing;
        }

        const parsedEnv = parseEnvironmentVariables(this.settings.environmentVariables || '');
        const fromBridge = this.normalizeGitBashPath(env.get('Git_for_claudecode') || '');
        const fromSettings = this.normalizeGitBashPath(parsedEnv.CLAUDE_CODE_GIT_BASH_PATH || fromBridge || '');
        if (fromSettings && this.fileExists(fromSettings)) {
            try {
                env.set('CLAUDE_CODE_GIT_BASH_PATH', fromSettings);
            } catch {
                // ignore environment set failures
            }
            return fromSettings;
        }

        for (const candidate of this.getGitBashCandidates(env)) {
            if (!this.fileExists(candidate)) continue;
            try {
                env.set('CLAUDE_CODE_GIT_BASH_PATH', candidate);
            } catch {
                // ignore environment set failures
            }
            return candidate;
        }

        return null;
    }

    private getWindowsProcessEnvironment(): any | null {
        try {
            const env = Components.classes['@mozilla.org/process/environment;1']
                .getService(Components.interfaces.nsIEnvironment);
            const os = (env.get('OS') || '').toLowerCase();
            const pathVar = env.get('PATH') || '';
            const comspec = env.get('COMSPEC') || env.get('ComSpec') || '';
            const isWindows = os.includes('windows') || pathVar.includes(';') || !!comspec;
            return isWindows ? env : null;
        } catch {
            return null;
        }
    }

    private getGitBashCandidates(env: any): string[] {
        const candidates = new Set<string>();

        const addCandidate = (value: string): void => {
            const normalized = this.normalizeGitBashPath(value);
            if (normalized) {
                candidates.add(normalized);
            }
        };

        addCandidate('C:\\Program Files\\Git\\bin\\bash.exe');
        addCandidate('C:\\Program Files\\Git\\usr\\bin\\bash.exe');
        addCandidate('C:\\Program Files (x86)\\Git\\bin\\bash.exe');
        addCandidate('C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe');

        const programFiles = env.get('ProgramFiles') || '';
        const programFilesX86 = env.get('ProgramFiles(x86)') || '';
        const localAppData = env.get('LOCALAPPDATA') || '';

        if (programFiles) {
            addCandidate(programFiles + '\\Git\\bin\\bash.exe');
            addCandidate(programFiles + '\\Git\\usr\\bin\\bash.exe');
        }
        if (programFilesX86) {
            addCandidate(programFilesX86 + '\\Git\\bin\\bash.exe');
            addCandidate(programFilesX86 + '\\Git\\usr\\bin\\bash.exe');
        }
        if (localAppData) {
            addCandidate(localAppData + '\\Programs\\Git\\bin\\bash.exe');
            addCandidate(localAppData + '\\Programs\\Git\\usr\\bin\\bash.exe');
        }

        const pathVar = env.get('PATH') || '';
        for (const rawDir of pathVar.split(';')) {
            const dir = rawDir.trim().replace(/^"|"$/g, '');
            if (!dir) continue;

            addCandidate(dir + '\\bash.exe');

            if (/\\cmd$/i.test(dir)) {
                const root = dir.slice(0, -4);
                addCandidate(root + '\\bin\\bash.exe');
                addCandidate(root + '\\usr\\bin\\bash.exe');
            }
        }

        return Array.from(candidates);
    }

    private normalizeGitBashPath(value: string): string | null {
        const raw = String(value || '').trim().replace(/^"|"$/g, '');
        if (!raw) return null;

        const normalized = raw.replace(/\//g, '\\');
        if (/\.(exe|cmd|bat)$/i.test(normalized)) {
            return normalized;
        }

        return normalized.endsWith('\\') ? `${normalized}bash.exe` : `${normalized}\\bash.exe`;
    }

    private fileExists(path: string): boolean {
        if (!path) return false;
        try {
            const file = Components.classes['@mozilla.org/file/local;1']
                .createInstance(Components.interfaces.nsIFile);
            file.initWithPath(path);
            return file.exists() && file.isFile();
        } catch {
            return false;
        }
    }

    private getProcessEnvironment(): any | null {
        try {
            return Components.classes['@mozilla.org/process/environment;1']
                .getService(Components.interfaces.nsIEnvironment);
        } catch {
            return null;
        }
    }

    private applyRuntimeEnvironment(gitBashPath?: string | null): void {
        const env = this.getProcessEnvironment();
        if (!env) return;

        const envVars = parseEnvironmentVariables(this.settings.environmentVariables || '');

        const fromBridge = this.normalizeGitBashPath(env.get('Git_for_claudecode') || '');
        const normalizedGitBash = this.normalizeGitBashPath(gitBashPath || fromBridge || '');
        if (normalizedGitBash && !envVars.CLAUDE_CODE_GIT_BASH_PATH) {
            envVars.CLAUDE_CODE_GIT_BASH_PATH = normalizedGitBash;
        }

        for (const [key, value] of Object.entries(envVars)) {
            try {
                env.set(key, String(value));
            } catch {
                // ignore set failures
            }
        }
    }

    private buildCliSettingsArg(gitBashPath?: string | null): string | null {
        const envVars = parseEnvironmentVariables(this.settings.environmentVariables || '');

        const normalizedGitBash = this.normalizeGitBashPath(gitBashPath || '');
        if (normalizedGitBash && !envVars.CLAUDE_CODE_GIT_BASH_PATH) {
            envVars.CLAUDE_CODE_GIT_BASH_PATH = normalizedGitBash;
        }

        if (Object.keys(envVars).length === 0) return null;

        try {
            // Align with Claude settings schema: { "env": { ... } }
            return JSON.stringify({ env: envVars });
        } catch {
            return null;
        }
    }

    private isValidUuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    private async waitForPromiseWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
        await Promise.race([
            promise.then(() => undefined).catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
    }

    private formatCliExitError(exitCode: number, stderrText: string): string {
        const cleaned = (stderrText || '').trim();
        const lower = cleaned.toLowerCase();

        if (lower.includes('requires git-bash')) {
            return 'Claude CLI requires Git Bash on Windows. Install Git for Windows, then set CLAUDE_CODE_GIT_BASH_PATH (for example: C:\\Program Files\\Git\\bin\\bash.exe).';
        }

        if (lower.includes('unable to find claude_code_git_bash_path')) {
            return 'Claude CLI could not access CLAUDE_CODE_GIT_BASH_PATH. Verify the path points to bash.exe, then restart Zotero.';
        }

        if (lower.includes('session id') && lower.includes('already in use')) {
            return 'Current conversation session is locked by another Claude process. Please wait a few seconds and retry, or start a New chat.';
        }

        if (lower.includes('invalid json provided to --settings')) {
            return 'Claude CLI rejected runtime settings JSON. Check Environment Variables format (KEY=VALUE, one per line, no invalid quotes).';
        }

        if (lower.includes('requires --verbose') && lower.includes('stream-json')) {
            return 'Your Claude CLI requires --verbose when using stream-json. Zoclau now adds this automatically; restart Zotero and try again.';
        }

        if (lower.includes('unknown option') && lower.includes('--thinking-budget')) {
            return 'Your Claude CLI version does not support --thinking-budget. Zoclau now runs in compatibility mode; restart Zotero and try again.';
        }

        if (lower.includes('unknown option') && lower.includes('--max-turns')) {
            return 'Your Claude CLI version does not support --max-turns. Zoclau removed this flag; restart Zotero and try again.';
        }

        if (lower.includes('not authenticated') || lower.includes('run "claude auth"') || lower.includes('claude auth')) {
            return 'Claude CLI is not authenticated. Run "claude auth login" in terminal first, then restart Zotero.';
        }

        if (cleaned) {
            return `Claude CLI exited with code ${exitCode}: ${cleaned}`;
        }

        if (exitCode === -9) {
            return 'Claude CLI process ended unexpectedly (exit -9). This can happen when the process is force-stopped or blocked by system policies.';
        }

        return `Claude CLI exited with code ${exitCode} without a readable error message.`;
    }

    abort(): void {
        this.abortRequested = true;
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
            } catch {
                // ignore
            }
            this.currentProcess = null;
        }
        this.isRunning = false;
    }

    shutdown(): void {
        this.abort();
        this.sessionByConversation.clear();
        this.onMessageCallback = null;
        this.onStreamCallback = null;
        this.onToolUseCallback = null;
        this.onToolResultCallback = null;
        this.onErrorCallback = null;
        this.onStreamStartCallback = null;
        this.onStreamEndCallback = null;
    }
}





































