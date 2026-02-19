/**
 * MessageRenderer - Renders chat messages to HTML.
 * Handles user/assistant messages, tool use blocks, code blocks, and streaming.
 */

import { markdownToHtml } from '../utils/markdown';
import type { ChatMessage, ToolUseBlock, ToolResultBlock } from '../settings/types';

function createCopyIcon(doc: Document): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const rect = doc.createElementNS(ns, 'rect');
    rect.setAttribute('x', '9'); rect.setAttribute('y', '9');
    rect.setAttribute('width', '13'); rect.setAttribute('height', '13');
    rect.setAttribute('rx', '2');
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
    svg.appendChild(rect);
    svg.appendChild(path);
    return svg;
}

function createCheckIcon(doc: Document): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const polyline = doc.createElementNS(ns, 'polyline');
    polyline.setAttribute('points', '20 6 9 17 4 12');
    svg.appendChild(polyline);
    return svg;
}

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
    wrapper.className = `zoclau-message zoclau-message-${message.role}`;
    wrapper.setAttribute('data-message-id', message.id);

    const textBlock = doc.createElement('div');
    textBlock.className = 'zoclau-text-block';

    const contentEl = doc.createElement('div');
    contentEl.className = 'zoclau-message-content';

    if (message.role === 'user') {
        contentEl.textContent = message.content;
    } else {
        contentEl.innerHTML = markdownToHtml(message.content);
    }

    textBlock.appendChild(contentEl);

    if (message.role === 'assistant' && !message.isStreaming) {
        const copyBtn = doc.createElement('button');
        copyBtn.className = 'zoclau-text-copy-btn';
        copyBtn.type = 'button';
        copyBtn.appendChild(createCopyIcon(doc));
        copyBtn.addEventListener('click', async () => {
            const ok = await copyText(message.content, doc);
            copyBtn.replaceChildren(ok ? createCheckIcon(doc) : createCopyIcon(doc));
            setTimeout(() => {
                copyBtn.replaceChildren(createCopyIcon(doc));
            }, 1200);
        });
        textBlock.appendChild(copyBtn);
    }

    if (message.isStreaming) {
        const indicator = doc.createElement('span');
        indicator.className = 'zoclau-streaming-indicator';
        indicator.textContent = '...';
        contentEl.appendChild(indicator);
    }

    wrapper.appendChild(textBlock);

    if (message.role === 'user') {
        const actions = doc.createElement('div');
        actions.className = 'zoclau-user-msg-actions';

        const copyBtn = doc.createElement('button');
        copyBtn.className = 'zoclau-user-msg-action';
        copyBtn.type = 'button';
        copyBtn.appendChild(createCopyIcon(doc));
        copyBtn.title = '复制';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await copyText(message.content, doc);
            copyBtn.replaceChildren(ok ? createCheckIcon(doc) : createCopyIcon(doc));
            setTimeout(() => {
                copyBtn.replaceChildren(createCopyIcon(doc));
            }, 1200);
        });
        actions.appendChild(copyBtn);

        wrapper.appendChild(actions);
    }

    return wrapper;
}

/**
 * Render a tool use notification.
 */
export function renderToolUse(block: ToolUseBlock, doc: Document): HTMLElement {
    const wrapper = doc.createElement('div');
    wrapper.className = 'zoclau-tool-use zoclau-tool-call';
    wrapper.setAttribute('data-tool-id', block.id);

    const header = doc.createElement('div');
    header.className = 'zoclau-tool-header';

    const name = doc.createElement('span');
    name.className = 'zoclau-tool-name';
    name.textContent = block.name;
    header.appendChild(name);

    const status = doc.createElement('span');
    status.className = 'zoclau-tool-status zoclau-tool-status-running';
    status.textContent = '运行中';
    header.appendChild(status);

    wrapper.appendChild(header);

    if (block.input) {
        const toggle = doc.createElement('button');
        toggle.className = 'zoclau-tool-toggle';
        toggle.type = 'button';
        toggle.textContent = '显示输入';

        const inputEl = doc.createElement('pre');
        inputEl.className = 'zoclau-tool-input';
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
    wrapper.className = `zoclau-tool-result zoclau-tool-call ${block.isError ? 'zoclau-tool-error' : ''}`;

    const row = doc.createElement('div');
    row.className = 'zoclau-tool-result-row';

    const label = doc.createElement('span');
    label.className = `zoclau-tool-result-label ${block.isError ? 'zoclau-tool-status-error' : 'zoclau-tool-status-completed'}`;
    label.textContent = block.isError ? '错误' : '完成';
    row.appendChild(label);

    if (block.content) {
        const content = doc.createElement('pre');
        content.className = 'zoclau-tool-result-text';
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
    wrapper.className = 'zoclau-error';

    const text = doc.createElement('span');
    text.className = 'zoclau-error-text';
    // Insert zero-width spaces every 40 chars to allow line breaking on long unbreakable strings
    const errorText = `错误：${error}`.replace(/(.{40})/g, '$1\u200B');
    text.textContent = errorText;
    wrapper.appendChild(text);

    if (options?.onRetry) {
        const retryBtn = doc.createElement('button');
        retryBtn.className = 'zoclau-error-retry';
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
    const contentEl = messageEl.querySelector('.zoclau-message-content');
    if (contentEl) {
        contentEl.innerHTML = markdownToHtml(content);
        const indicator = doc.createElement('span');
        indicator.className = 'zoclau-streaming-indicator';
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

