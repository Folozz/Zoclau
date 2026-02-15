/**
 * MessageRenderer - Renders chat messages to HTML.
 * Handles user/assistant messages, tool use blocks, code blocks, and streaming.
 */

import { markdownToHtml } from '../utils/markdown';
import type { ChatMessage, ToolUseBlock, ToolResultBlock } from '../settings/types';

export interface RenderMessageOptions {
    onUserResend?: (content: string) => void;
}

export interface RenderErrorOptions {
    onRetry?: () => void;
}

/**
 * Render a chat message to an HTML element.
 */
export function renderMessage(message: ChatMessage, doc: Document, options?: RenderMessageOptions): HTMLElement {
    const wrapper = doc.createElement('div');
    wrapper.className = `zeclau-message zeclau-message-${message.role}`;
    wrapper.setAttribute('data-message-id', message.id);

    const textBlock = doc.createElement('div');
    textBlock.className = 'zeclau-text-block';

    const contentEl = doc.createElement('div');
    contentEl.className = 'zeclau-message-content';

    if (message.role === 'user') {
        contentEl.textContent = message.content;
    } else {
        contentEl.innerHTML = markdownToHtml(message.content);
    }

    textBlock.appendChild(contentEl);

    if (message.role === 'assistant' && !message.isStreaming) {
        const copyBtn = doc.createElement('button');
        copyBtn.className = 'zeclau-text-copy-btn';
        copyBtn.type = 'button';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', async () => {
            const ok = await copyText(message.content, doc);
            copyBtn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(() => {
                copyBtn.textContent = '复制';
            }, 1200);
        });
        textBlock.appendChild(copyBtn);
    }

    if (message.isStreaming) {
        const indicator = doc.createElement('span');
        indicator.className = 'zeclau-streaming-indicator';
        indicator.textContent = '...';
        contentEl.appendChild(indicator);
    }

    wrapper.appendChild(textBlock);

    if (message.role === 'user') {
        const actions = doc.createElement('div');
        actions.className = 'zeclau-user-msg-actions';

        const copyBtn = doc.createElement('button');
        copyBtn.className = 'zeclau-user-msg-action';
        copyBtn.type = 'button';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await copyText(message.content, doc);
            copyBtn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(() => {
                copyBtn.textContent = '复制';
            }, 1200);
        });
        actions.appendChild(copyBtn);

        if (options?.onUserResend) {
            const resendBtn = doc.createElement('button');
            resendBtn.className = 'zeclau-user-msg-action';
            resendBtn.type = 'button';
            resendBtn.textContent = '重发';
            resendBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onUserResend?.(message.content);
            });
            actions.appendChild(resendBtn);
        }

        wrapper.appendChild(actions);
    }

    return wrapper;
}

/**
 * Render a tool use notification.
 */
export function renderToolUse(block: ToolUseBlock, doc: Document): HTMLElement {
    const wrapper = doc.createElement('div');
    wrapper.className = 'zeclau-tool-use zeclau-tool-call';

    const header = doc.createElement('div');
    header.className = 'zeclau-tool-header';

    const name = doc.createElement('span');
    name.className = 'zeclau-tool-name';
    name.textContent = block.name;
    header.appendChild(name);

    const status = doc.createElement('span');
    status.className = 'zeclau-tool-status zeclau-tool-status-running';
    status.textContent = '运行中';
    header.appendChild(status);

    wrapper.appendChild(header);

    if (block.input) {
        const toggle = doc.createElement('button');
        toggle.className = 'zeclau-tool-toggle';
        toggle.type = 'button';
        toggle.textContent = '显示输入';

        const inputEl = doc.createElement('pre');
        inputEl.className = 'zeclau-tool-input';
        inputEl.textContent = typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input, null, 2);
        inputEl.style.display = 'none';

        toggle.addEventListener('click', () => {
            const isHidden = inputEl.style.display === 'none';
            inputEl.style.display = isHidden ? 'block' : 'none';
            toggle.textContent = isHidden ? '隐藏输入' : '显示输入';
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(inputEl);
    }

    return wrapper;
}

/**
 * Render a tool result notification.
 */
export function renderToolResult(block: ToolResultBlock, doc: Document): HTMLElement {
    const wrapper = doc.createElement('div');
    wrapper.className = `zeclau-tool-result zeclau-tool-call ${block.isError ? 'zeclau-tool-error' : ''}`;

    const row = doc.createElement('div');
    row.className = 'zeclau-tool-result-row';

    const label = doc.createElement('span');
    label.className = `zeclau-tool-result-label ${block.isError ? 'zeclau-tool-status-error' : 'zeclau-tool-status-completed'}`;
    label.textContent = block.isError ? '错误' : '完成';
    row.appendChild(label);

    if (block.content) {
        const content = doc.createElement('pre');
        content.className = 'zeclau-tool-result-text';
        content.textContent = block.content.length > 1200
            ? block.content.substring(0, 1200) + '...'
            : block.content;
        row.appendChild(content);
    }

    wrapper.appendChild(row);
    return wrapper;
}

/**
 * Render an error message.
 */
export function renderError(error: string, doc: Document, options?: RenderErrorOptions): HTMLElement {
    const wrapper = doc.createElement('div');
    wrapper.className = 'zeclau-error';

    const text = doc.createElement('span');
    text.className = 'zeclau-error-text';
    text.textContent = `错误：${error}`;
    wrapper.appendChild(text);

    if (options?.onRetry) {
        const retryBtn = doc.createElement('button');
        retryBtn.className = 'zeclau-error-retry';
        retryBtn.type = 'button';
        retryBtn.textContent = '重试';
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            options.onRetry?.();
        });
        wrapper.appendChild(retryBtn);
    }

    return wrapper;
}

/**
 * Update the streaming content of an existing message element.
 */
export function updateStreamingMessage(
    messageEl: HTMLElement,
    content: string,
    doc: Document,
): void {
    const contentEl = messageEl.querySelector('.zeclau-message-content');
    if (contentEl) {
        contentEl.innerHTML = markdownToHtml(content);
        const indicator = doc.createElement('span');
        indicator.className = 'zeclau-streaming-indicator';
        indicator.textContent = '...';
        contentEl.appendChild(indicator);
    }
}

async function copyText(text: string, doc: Document): Promise<boolean> {
    try {
        const nav = doc.defaultView?.navigator;
        if (nav?.clipboard?.writeText) {
            await nav.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }

    try {
        const area = doc.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        doc.body.appendChild(area);
        area.focus();
        area.select();
        const ok = doc.execCommand('copy');
        area.remove();
        return !!ok;
    } catch {
        return false;
    }
}

