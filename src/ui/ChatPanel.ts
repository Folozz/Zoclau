
/**
 * ChatPanel - Renders the embedded chat UI in Zotero item pane.
 */

import type { ChatMessage, ToolUseBlock, ToolResultBlock, ClaudeModel, ConversationMeta } from '../settings/types';
import { getCurrentModelFromEnvironment, getModelsFromEnvironment, parseEnvironmentVariables } from '../utils/env';
import { ClaudeService } from '../service/ClaudeService';
import { ConversationManager } from './ConversationManager';
import {
    renderMessage,
    renderToolUse,
    renderToolResult,
    renderError,
    updateStreamingMessage,
} from './MessageRenderer';

declare const Zotero: any;
declare const Components: any;

interface ContextEntry {
    key: string;
    title: string;
    content: string;
}

interface LocalFileEntry {
    path: string;
    name: string;
    size: number;
    preview: string;
}

const DEFAULT_MODELS: { value: ClaudeModel; label: string }[] = [
    { value: 'auto', label: '自动（使用 Claude 设置）' },
    { value: 'haiku', label: 'Haiku（快速）' },
    { value: 'sonnet', label: 'Sonnet（均衡）' },
    { value: 'opus', label: 'Opus（强大）' },
];

export class ChatPanel {
    private doc: Document;
    private container: HTMLElement;
    private service: ClaudeService;
    private conversationManager: ConversationManager;
    private settings: any;

    // DOM
    private messagesWrapper: HTMLElement | null = null;
    private messagesContainer: HTMLElement | null = null;
    private inputTextarea: HTMLTextAreaElement | null = null;
    private sendButton: HTMLButtonElement | null = null;
    private stopButton: HTMLButtonElement | null = null;
    private modelSelector: HTMLSelectElement | null = null;
    private statusBar: HTMLElement | null = null;
    private statusDot: HTMLElement | null = null;
    private conversationTitleBtn: HTMLButtonElement | null = null;
    private historyToggleBtn: HTMLButtonElement | null = null;
    private historyMenu: HTMLElement | null = null;
    private currentItemChip: HTMLButtonElement | null = null;
    private currentItemClearBtn: HTMLButtonElement | null = null;
    private selectedContextWrap: HTMLElement | null = null;
    private localFilesWrap: HTMLElement | null = null;
    private scrollRail: HTMLElement | null = null;
    private scrollTopBtn: HTMLButtonElement | null = null;
    private scrollBottomBtn: HTMLButtonElement | null = null;
    private mentionDropdown: HTMLElement | null = null;
    private docClickHandler: ((event: MouseEvent) => void) | null = null;

    // State
    private currentStreamingEl: HTMLElement | null = null;
    private enableAutoScroll = true;
    private followNewest = true;
    private callbacksWired = false;
    private selectedItemContext: ContextEntry | null = null;
    private mentionActiveIndex = 0;
    private mentionMatches: ContextEntry[] = [];
    private currentMentionRange: { start: number; end: number } | null = null;
    private mentionCacheAt = 0;
    private mentionCache: ContextEntry[] = [];
    private selectedLocalFiles: LocalFileEntry[] = [];
    private selectedPaperContexts: ContextEntry[] = [];
    private historyMenuRowHeight = 44;

    constructor(
        doc: Document,
        container: HTMLElement,
        service: ClaudeService,
        conversationManager: ConversationManager,
        settings: any,
    ) {
        this.doc = doc;
        this.container = container;
        this.service = service;
        this.conversationManager = conversationManager;
        this.settings = settings;
        this.enableAutoScroll = settings.enableAutoScroll;
        this.hydrateModelFromEnvironment();
    }

    build(): void {
        this.container.innerHTML = '';
        this.container.className = 'zeclau-panel zeclau-panel-embedded';
        this.container.style.display = 'grid';
        this.container.style.gridTemplateRows = 'minmax(0, 1fr) auto';
        this.container.style.height = '100%';
        this.container.style.maxHeight = '100%';
        this.container.style.minHeight = '0';
        this.container.style.overflow = 'hidden';

        this.messagesWrapper = this.doc.createElement('div');
        this.messagesWrapper.className = 'zeclau-messages-wrapper';
        this.messagesWrapper.style.minHeight = '390px';
        this.messagesWrapper.style.height = '390px';
        this.messagesWrapper.style.maxHeight = '390px';
        this.messagesWrapper.style.overflow = 'hidden';

        this.messagesContainer = this.doc.createElement('div');
        this.messagesContainer.className = 'zeclau-messages';
        this.messagesContainer.style.minHeight = '0';
        this.messagesContainer.style.height = '100%';
        this.messagesContainer.style.maxHeight = '100%';
        this.messagesContainer.style.overflowY = 'auto';
        this.messagesContainer.style.overflowX = 'hidden';
        this.messagesContainer.addEventListener('scroll', () => this.updateScrollButtonsState());
        this.messagesWrapper.appendChild(this.messagesContainer);

        this.scrollRail = this.buildScrollRail();
        this.messagesWrapper.appendChild(this.scrollRail);

        this.container.appendChild(this.messagesWrapper);
        this.container.appendChild(this.buildInputArea());

        if (!this.callbacksWired) {
            this.wireCallbacks();
            this.callbacksWired = true;
        }

        this.ensureActiveConversation();
        this.renderConversationOptions();
        this.renderCurrentItemChip();
        this.renderAllMessages();
        this.updateStatus('就绪');
        this.updateScrollButtonsState();
    }

    onItemChange(item: any): void {
        this.selectedItemContext = this.extractItemContext(item);
        this.mentionCacheAt = 0;
        this.renderCurrentItemChip();
    }

    updateSettings(nextSettings: any): void {
        this.settings = { ...nextSettings };
        this.enableAutoScroll = !!this.settings.enableAutoScroll;
        this.renderModelSelectorOptions();
        this.updateScrollButtonsState();
    }

    private getEnvVars(): Record<string, string> {
        return parseEnvironmentVariables((this.settings?.environmentVariables || '').toString());
    }

    private hydrateModelFromEnvironment(): void {
        const envModel = getCurrentModelFromEnvironment(this.getEnvVars());
        if (!envModel) return;

        const rawModel = (this.settings?.model || '').toString().trim();
        const shouldAdoptEnv = !rawModel || rawModel === 'haiku' || rawModel === 'sonnet' || rawModel === 'opus';
        if (shouldAdoptEnv) {
            this.settings.model = envModel;
            this.service.updateSettings(this.settings);
        }
    }

    private getModelOptions(): { value: ClaudeModel; label: string }[] {
        const options: { value: ClaudeModel; label: string }[] = [...DEFAULT_MODELS];
        const existing = new Set(options.map((m) => m.value));

        for (const custom of getModelsFromEnvironment(this.getEnvVars())) {
            if (existing.has(custom.value)) continue;
            existing.add(custom.value);
            options.push({ value: custom.value, label: custom.label });
        }

        const selectedModel = (this.settings?.model || '').toString().trim();
        if (selectedModel && !existing.has(selectedModel)) {
            options.push({ value: selectedModel, label: selectedModel });
        }

        return options;
    }

    private renderModelSelectorOptions(): void {
        if (!this.modelSelector) return;

        const selected = (this.settings?.model || 'auto').toString();
        this.modelSelector.innerHTML = '';

        for (const model of this.getModelOptions()) {
            const option = this.doc.createElement('option');
            option.value = model.value;
            option.textContent = model.label;
            if (model.value === selected) {
                option.selected = true;
            }
            this.modelSelector.appendChild(option);
        }

        if (this.modelSelector.value !== selected && this.modelSelector.options.length > 0) {
            this.modelSelector.value = selected;
        }
    }
    private getModelMetaLabel(): string {
        const model = String(this.settings?.model || 'auto').trim();
        if (!model || model === 'auto') {
            return 'Auto';
        }
        if (model === 'haiku') return 'Haiku';
        if (model === 'sonnet') return 'Sonnet';
        if (model === 'opus') return 'Opus';
        return model;
    }

    private buildConversationRow(): HTMLElement {
        const row = this.doc.createElement('div');
        row.className = 'zeclau-conversation-row';

        const titleWrap = this.doc.createElement('div');
        titleWrap.className = 'zeclau-conversation-title-wrap';

        this.conversationTitleBtn = this.doc.createElement('button');
        this.conversationTitleBtn.type = 'button';
        this.conversationTitleBtn.className = 'zeclau-conversation-title';
        this.conversationTitleBtn.textContent = '会话';
        this.conversationTitleBtn.title = '切换会话';
        this.conversationTitleBtn.addEventListener('click', () => this.toggleHistoryMenu());

        this.historyMenu = this.doc.createElement('div');
        this.historyMenu.className = 'zeclau-history-menu';
        this.historyMenu.style.display = 'none';

        titleWrap.appendChild(this.conversationTitleBtn);
        titleWrap.appendChild(this.historyMenu);

        const actions = this.doc.createElement('div');
        actions.className = 'zeclau-conversation-actions';

        this.historyToggleBtn = this.doc.createElement('button');
        this.historyToggleBtn.type = 'button';
        this.historyToggleBtn.className = 'zeclau-btn zeclau-btn-icon-lite';
        this.historyToggleBtn.textContent = '历史';
        this.historyToggleBtn.title = '历史会话';
        this.historyToggleBtn.addEventListener('click', () => this.toggleHistoryMenu());

        const newBtn = this.doc.createElement('button');
        newBtn.className = 'zeclau-btn zeclau-btn-icon-lite';
        newBtn.textContent = '新建';
        newBtn.title = '新建会话';
        newBtn.addEventListener('click', () => this.newChat());

        const delBtn = this.doc.createElement('button');
        delBtn.className = 'zeclau-btn zeclau-btn-delete-lite';
        delBtn.textContent = '删除';
        delBtn.title = '删除当前会话';
        delBtn.addEventListener('click', () => this.deleteCurrentConversation());

        const live = this.doc.createElement('div');
        live.className = 'zeclau-live-badge zeclau-live-badge-compact';
        this.statusDot = this.doc.createElement('span');
        this.statusDot.className = 'zeclau-live-dot';
        const liveText = this.doc.createElement('span');
        liveText.textContent = '在线';
        live.appendChild(this.statusDot);
        live.appendChild(liveText);

        actions.appendChild(live);
        actions.appendChild(this.historyToggleBtn);
        actions.appendChild(newBtn);
        actions.appendChild(delBtn);

        row.appendChild(titleWrap);
        row.appendChild(actions);
        return row;
    }

    private buildInputArea(): HTMLElement {
        const inputArea = this.doc.createElement('div');
        inputArea.className = 'zeclau-input-area';

        const toolbar = this.doc.createElement('div');
        toolbar.className = 'zeclau-composer-toolbar';

        const newBtn = this.doc.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'zeclau-icon-btn zeclau-toolbar-btn zeclau-toolbar-btn-new';
        newBtn.title = '新建会话';
        newBtn.appendChild(this.createToolbarIcon('new'));
        newBtn.addEventListener('click', () => this.newChat());

        const historyWrap = this.doc.createElement('div');
        historyWrap.className = 'zeclau-history-wrap';

        this.historyToggleBtn = this.doc.createElement('button');
        this.historyToggleBtn.type = 'button';
        this.historyToggleBtn.className = 'zeclau-icon-btn zeclau-toolbar-btn zeclau-toolbar-btn-history';
        this.historyToggleBtn.title = '历史会话';
        this.historyToggleBtn.appendChild(this.createToolbarIcon('history'));
        this.historyToggleBtn.addEventListener('click', () => this.toggleHistoryMenu());

        this.historyMenu = this.doc.createElement('div');
        this.historyMenu.className = 'zeclau-history-menu';
        this.historyMenu.style.display = 'none';
        this.historyMenu.style.overflowY = 'scroll';
        this.historyMenu.style.overscrollBehavior = 'contain';
        this.historyMenu.addEventListener('wheel', (event: WheelEvent) => {
            const menu = this.historyMenu;
            if (!menu) return;
            if (menu.scrollHeight <= menu.clientHeight) return;
            const before = menu.scrollTop;
            menu.scrollTop += event.deltaY;
            if (menu.scrollTop !== before) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, { passive: false });

        historyWrap.appendChild(this.historyToggleBtn);
        historyWrap.appendChild(this.historyMenu);

        toolbar.appendChild(newBtn);
        toolbar.appendChild(historyWrap);
        inputArea.appendChild(toolbar);

        const shell = this.doc.createElement('div');
        shell.className = 'zeclau-input-shell';

        const chipRow = this.doc.createElement('div');
        chipRow.className = 'zeclau-input-chip-row';

        const currentItemGroup = this.doc.createElement('div');
        currentItemGroup.className = 'zeclau-current-item-group';

        this.currentItemChip = this.doc.createElement('button');
        this.currentItemChip.type = 'button';
        this.currentItemChip.className = 'zeclau-current-item-chip zeclau-current-item-chip-inline';
        this.currentItemChip.addEventListener('click', () => {
            if (this.selectedItemContext) {
                this.addSelectedPaperContext(this.selectedItemContext);
            } else {
                this.triggerMentionPicker();
            }
        });

        this.currentItemClearBtn = this.doc.createElement('button');
        this.currentItemClearBtn.type = 'button';
        this.currentItemClearBtn.className = 'zeclau-context-clear-btn';
        this.currentItemClearBtn.textContent = '×';
        this.currentItemClearBtn.title = '取消当前文献';
        this.currentItemClearBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.selectedItemContext = null;
            this.renderCurrentItemChip();
        });

        currentItemGroup.appendChild(this.currentItemChip);
        currentItemGroup.appendChild(this.currentItemClearBtn);

        this.selectedContextWrap = this.doc.createElement('div');
        this.selectedContextWrap.className = 'zeclau-selected-context-wrap';

        this.localFilesWrap = this.doc.createElement('div');
        this.localFilesWrap.className = 'zeclau-local-files-wrap';

        chipRow.appendChild(currentItemGroup);
        chipRow.appendChild(this.selectedContextWrap);
        chipRow.appendChild(this.localFilesWrap);
        shell.appendChild(chipRow);

        this.inputTextarea = this.doc.createElement('textarea');
        this.inputTextarea.className = 'zeclau-input zeclau-input-embedded';
        this.inputTextarea.placeholder = 'How can I help you today?';
        this.inputTextarea.rows = 2;
        this.inputTextarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (this.mentionDropdown && this.mentionDropdown.style.display !== 'none') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveMentionSelection(1);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveMentionSelection(-1);
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey && this.mentionMatches.length > 0) {
                    e.preventDefault();
                    this.applyMention(this.mentionMatches[this.mentionActiveIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.hideMentionDropdown();
                    return;
                }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void this.handleSend();
            }
        });
        this.inputTextarea.addEventListener('input', () => {
            if (this.inputTextarea) {
                this.inputTextarea.style.height = 'auto';
                this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, 220)}px`;
            }
            this.updateMentionDropdown();
        });
        this.inputTextarea.addEventListener('blur', () => {
            setTimeout(() => this.hideMentionDropdown(), 120);
        });
        shell.appendChild(this.inputTextarea);

        this.mentionDropdown = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
        this.mentionDropdown.className = 'zeclau-mention-dropdown';
        this.mentionDropdown.style.display = 'none';
        shell.appendChild(this.mentionDropdown);

        const footer = this.doc.createElement('div');
        footer.className = 'zeclau-input-footer';

        const footerLeft = this.doc.createElement('div');
        footerLeft.className = 'zeclau-input-footer-left';

        const modelMeta = this.doc.createElement('span');
        modelMeta.className = 'zeclau-meta-badge zeclau-meta-model';
        modelMeta.textContent = this.getModelMetaLabel();

        const thinkingMeta = this.doc.createElement('span');
        thinkingMeta.className = 'zeclau-meta-badge zeclau-meta-thinking';
        thinkingMeta.textContent = `Thinking: ${String(this.settings?.thinkingBudget || 'off')}`;

        const addFolderBtn = this.doc.createElement('button');
        addFolderBtn.type = 'button';
        addFolderBtn.className = 'zeclau-icon-btn zeclau-file-picker-btn zeclau-toolbar-btn zeclau-toolbar-btn-folder';
        addFolderBtn.title = '选择本地文件夹';
        addFolderBtn.appendChild(this.createToolbarIcon('folder'));
        addFolderBtn.addEventListener('click', () => this.pickLocalFiles());

        footerLeft.appendChild(modelMeta);
        footerLeft.appendChild(thinkingMeta);
        footerLeft.appendChild(addFolderBtn);

        const actionGroup = this.doc.createElement('div');
        actionGroup.className = 'zeclau-input-action-group';

        this.stopButton = this.doc.createElement('button');
        this.stopButton.className = 'zeclau-btn zeclau-btn-stop';
        this.stopButton.textContent = '停止';
        this.stopButton.style.display = 'none';
        this.stopButton.addEventListener('click', () => {
            this.service.abort();
            this.updateStatus('已停止');
        });

        this.sendButton = this.doc.createElement('button');
        this.sendButton.className = 'zeclau-btn zeclau-btn-send';
        this.sendButton.textContent = '发送';
        this.sendButton.addEventListener('click', () => {
            void this.handleSend();
        });

        actionGroup.appendChild(this.stopButton);
        actionGroup.appendChild(this.sendButton);

        footer.appendChild(footerLeft);
        footer.appendChild(actionGroup);
        shell.appendChild(footer);

        inputArea.appendChild(shell);

        if (!this.docClickHandler) {
            this.docClickHandler = (event: MouseEvent) => {
                const target = event.target as Node | null;
                if (!target || !this.historyMenu) return;

                const clickedToggle = this.historyToggleBtn?.contains(target) || false;
                const clickedMenu = this.historyMenu.contains(target);

                if (!clickedToggle && !clickedMenu) {
                    this.hideHistoryMenu();
                }
            };
            this.doc.addEventListener('mousedown', this.docClickHandler);
        }

        this.renderCurrentItemChip();
        this.renderSelectedPaperContexts();
        this.renderSelectedLocalFiles();
        return inputArea;
    }

    private buildScrollRail(): HTMLElement {
        const rail = this.doc.createElement('div');
        rail.className = 'zeclau-scroll-rail';

        this.scrollTopBtn = this.createScrollButton('Scroll to top', 'top', () => this.scrollMessages('top'));

        this.scrollBottomBtn = this.createScrollButton('Scroll to bottom', 'bottom', () => this.scrollMessages('bottom'));


        rail.appendChild(this.scrollTopBtn);
        rail.appendChild(this.scrollBottomBtn);

        return rail;
    }

    private createScrollButton(
        title: string,
        kind: 'top' | 'bottom',
        onClick: () => void,
    ): HTMLButtonElement {
        const btn = this.doc.createElement('button');
        btn.type = 'button';
        btn.className = `zeclau-scroll-btn zeclau-scroll-btn-${kind}`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.appendChild(this.createScrollIcon(kind));
        btn.addEventListener('click', onClick);
        return btn;
    }

    private createScrollIcon(kind: 'top' | 'bottom'): SVGSVGElement {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = this.doc.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.55');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.classList.add('zeclau-scroll-btn-icon');

        const addPath = (d: string): void => {
            const path = this.doc.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            path.classList.add('zeclau-scroll-btn-line');
            svg.appendChild(path);
        };

        if (kind === 'top') {
            addPath('M4.5 5.4H19.5');
            addPath('M6.2 14.4L12 8.4L17.8 14.4');
        } else {
            addPath('M4.5 18.6H19.5');
            addPath('M6.2 9.6L12 15.6L17.8 9.6');
        }

        return svg;
    }

        private createToolbarIcon(kind: 'new' | 'history' | 'folder'): SVGSVGElement {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = this.doc.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.9');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.classList.add('zeclau-toolbar-icon');

        const addPath = (d: string): void => {
            const path = this.doc.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            path.classList.add('zeclau-toolbar-icon-path');
            svg.appendChild(path);
        };

        if (kind === 'new') {
            addPath('M12 5V19');
            addPath('M5 12H19');
        } else if (kind === 'history') {
            addPath('M4 6V10H8');
            addPath('M4.8 10A7.6 7.6 0 1 0 7.4 6.1');
            addPath('M12 9V12L14.5 13.8');
        } else {
            addPath('M3.5 8A2.5 2.5 0 0 1 6 5.5H9L10.8 7.5H18A2.5 2.5 0 0 1 20.5 10V16A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8Z');
            addPath('M3.5 10.5H20.5');
        }

        return svg;
    }

    private scrollMessages(direction: 'top' | 'bottom'): void {
        if (!this.messagesContainer) return;

        const c = this.messagesContainer;
        let target = c.scrollTop;

        if (direction === 'top') {
            target = 0;
            this.followNewest = false;
        } else if (direction === 'bottom') {
            target = c.scrollHeight;
            this.followNewest = true;
        }

        try {
            c.scrollTo({ top: target, behavior: 'smooth' });
        } catch {
            c.scrollTop = target;
        }

        setTimeout(() => this.updateScrollButtonsState(), 120);
    }

    private updateScrollButtonsState(): void {
        if (!this.messagesContainer) return;

        const c = this.messagesContainer;
        const maxTop = Math.max(0, c.scrollHeight - c.clientHeight);
        const atTop = c.scrollTop <= 2;
        const atBottom = maxTop - c.scrollTop <= 2;
        const hasOverflow = maxTop > 2;

        this.followNewest = atBottom;

        if (this.scrollRail) {
            this.scrollRail.classList.toggle('is-visible', hasOverflow);
            this.scrollRail.classList.toggle('is-inactive', !hasOverflow);
            this.scrollRail.style.display = hasOverflow ? 'flex' : 'none';
            this.scrollRail.style.pointerEvents = hasOverflow ? 'auto' : 'none';
        }

        if (this.scrollTopBtn) this.scrollTopBtn.disabled = atTop || !hasOverflow;
        if (this.scrollBottomBtn) this.scrollBottomBtn.disabled = atBottom || !hasOverflow;
    }

    private toggleHistoryMenu(): void {
        if (!this.historyMenu) return;
        const showing = this.historyMenu.style.display !== 'none';
        if (showing) {
            this.historyMenu.style.display = 'none';
            return;
        }

        this.historyMenu.style.display = 'block';
        const win = this.doc.defaultView;
        if (win && typeof win.requestAnimationFrame === 'function') {
            win.requestAnimationFrame(() => this.syncHistoryMenuHeightFromVisibleRow());
        } else {
            this.syncHistoryMenuHeightFromVisibleRow();
        }
    }

    private hideHistoryMenu(): void {
        if (this.historyMenu) {
            this.historyMenu.style.display = 'none';
        }
    }

    private syncHistoryMenuHeightFromVisibleRow(): void {
        if (!this.historyMenu || this.historyMenu.style.display === 'none') return;

        const firstRow = this.historyMenu.querySelector('.zeclau-history-row') as HTMLElement | null;
        const measuredRowHeight = firstRow ? Math.round(firstRow.getBoundingClientRect().height) : 0;
        if (measuredRowHeight >= 20 && measuredRowHeight <= 80) {
            this.historyMenuRowHeight = measuredRowHeight;
        }
        this.applyHistoryMenuFixedHeight(this.historyMenuRowHeight);
    }

    private renderHistoryMenu(conversations: ConversationMeta[], activeId: string): void {
        if (!this.historyMenu) return;
        this.historyMenu.innerHTML = '';

        if (conversations.length === 0) {
            const empty = this.doc.createElement('div');
            empty.className = 'zeclau-history-empty';
            empty.textContent = '暂无会话';
            this.historyMenu.appendChild(empty);
            this.applyHistoryMenuFixedHeight(this.historyMenuRowHeight);
            return;
        }

        for (const conv of conversations) {
            const row = this.doc.createElement('div');
            row.className = 'zeclau-history-row';

            const item = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
            item.type = 'button';
            item.style.display = 'block';
            item.style.width = '100%';
            item.style.margin = '0';
            item.className = 'zeclau-history-item';
            if (conv.id === activeId) {
                item.classList.add('is-active');
                row.classList.add('is-active');
            }
            item.title = conv.title;

            const title = this.doc.createElement('span');
            title.className = 'zeclau-history-item-title';
            title.textContent = conv.title;

            const meta = this.doc.createElement('span');
            meta.className = 'zeclau-history-item-time';
            meta.textContent = this.formatConversationTime(conv.updatedAt);

            item.appendChild(title);
            item.appendChild(meta);

            const deleteBtn = this.doc.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'zeclau-history-item-delete';
            deleteBtn.textContent = '×';
            deleteBtn.title = '删除会话';
            deleteBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.deleteConversationById(conv.id, true);
                this.updateStatus(`已删除会话：${this.truncateText(conv.title, 16)}`);
            });

            item.addEventListener('click', () => {
                this.switchConversation(conv.id);
                this.hideHistoryMenu();
            });

            row.appendChild(item);
            row.appendChild(deleteBtn);
            this.historyMenu.appendChild(row);
        }

        const firstRow = this.historyMenu.querySelector('.zeclau-history-row') as HTMLElement | null;
        const measuredRowHeight = firstRow ? Math.round(firstRow.getBoundingClientRect().height) : 0;
        if (measuredRowHeight >= 20 && measuredRowHeight <= 80) {
            this.historyMenuRowHeight = measuredRowHeight;
        }
        this.applyHistoryMenuFixedHeight(this.historyMenuRowHeight);
    }

    private applyHistoryMenuFixedHeight(rowHeight: number): void {
        if (!this.historyMenu) return;

        const style = this.doc.defaultView?.getComputedStyle(this.historyMenu);
        const padTop = style ? parseFloat(style.paddingTop || '0') : 0;
        const padBottom = style ? parseFloat(style.paddingBottom || '0') : 0;
        const borderTop = style ? parseFloat(style.borderTopWidth || '0') : 0;
        const borderBottom = style ? parseFloat(style.borderBottomWidth || '0') : 0;

        const visibleRows = 5;
        const menuHeight = Math.max(120, Math.round(rowHeight * visibleRows + padTop + padBottom + borderTop + borderBottom));
        const px = menuHeight + 'px';

        this.historyMenu.style.setProperty('height', px, 'important');
        this.historyMenu.style.setProperty('min-height', px, 'important');
        this.historyMenu.style.setProperty('max-height', px, 'important');
        this.historyMenu.style.setProperty('overflow-y', 'auto', 'important');
        this.historyMenu.style.setProperty('overflow-x', 'hidden', 'important');
    }

    private formatConversationTime(ts: number): string {
        try {
            return new Date(ts).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
        } catch {
            return '';
        }
    }
    private wireCallbacks(): void {
        this.service.onMessage((msg) => {
            const convId = this.conversationManager.getActiveId();
            if (convId) {
                this.conversationManager.addMessage(convId, msg);
            }

            if (this.currentStreamingEl) {
                this.currentStreamingEl.remove();
                this.currentStreamingEl = null;
            }

            this.appendMessageEl(msg);
            this.updateScrollButtonsState();
        });

        this.service.onStream((text: string, messageId: string) => {
            this.handleStreamUpdate(text, messageId);
        });

        this.service.onToolUse((block: ToolUseBlock) => {
            if (this.messagesContainer) {
                const el = renderToolUse(block, this.doc);
                this.messagesContainer.appendChild(el);
                this.scrollToBottom();
            }
        });

        this.service.onToolResult((block: ToolResultBlock) => {
            if (this.messagesContainer) {
                const el = renderToolResult(block, this.doc);
                this.messagesContainer.appendChild(el);
                this.scrollToBottom();
            }
        });

        this.service.onError((error: Error) => {
            if (this.messagesContainer) {
                const lastUserText = this.getLastUserMessageText();
                const el = renderError(
                    error.message,
                    this.doc,
                    lastUserText ? { onRetry: () => this.resendMessage(lastUserText) } : undefined,
                );
                this.messagesContainer.appendChild(el);
                this.scrollToBottom();
            }
            this.updateStatus('出错');
            this.setLiveState('error');
        });

        this.service.onStreamStart(() => {
            this.setInputEnabled(false);
            this.updateStatus('思考中...');
            this.setLiveState('thinking');
            if (this.stopButton) {
                this.stopButton.style.display = 'inline-block';
            }
        });

        this.service.onStreamEnd(() => {
            this.setInputEnabled(true);
            this.updateStatus('就绪');
            this.setLiveState('ready');
            if (this.stopButton) {
                this.stopButton.style.display = 'none';
            }
        });
    }

    private async handleSend(): Promise<void> {
        if (!this.inputTextarea || this.service.busy) return;

        const text = this.inputTextarea.value.trim();
        if (!text) return;

        this.followNewest = true;
        this.hideMentionDropdown();
        this.hideHistoryMenu();

        this.inputTextarea.value = '';
        this.inputTextarea.style.height = 'auto';

        const convId = this.ensureActiveConversation();
        const activeBeforeSend = this.conversationManager.getActive();
        const hadMessagesBeforeSend = this.conversationManager.getMessages(convId).length > 0;

        const userMessage: ChatMessage = {
            id: `msg_${Date.now()}_user`,
            role: 'user',
            content: text,
            timestamp: Date.now(),
        };

        this.conversationManager.addMessage(convId, userMessage);
        this.appendMessageEl(userMessage);

        if (activeBeforeSend && this.shouldAutoRenameConversation(activeBeforeSend.title) && !hadMessagesBeforeSend) {
            const nextTitle = this.deriveConversationTopic(text);
            if (nextTitle) {
                this.conversationManager.updateTitle(convId, nextTitle);
                this.renderConversationOptions();
            }
        }

        const enriched = this.buildPromptWithContexts(text);
        await this.service.sendMessage(enriched, convId);
    }

    private deriveConversationTopic(text: string): string {
        const cleaned = text
            .replace(/@\[[^\]]+\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned) {
            return '会话';
        }

        const firstSentence = cleaned.split(/[。！？!?\n]/).map((s) => s.trim()).find((s) => s.length > 0) || cleaned;
        const zhWords = firstSentence.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        if (zhWords.length > 0) {
            const topic = zhWords.slice(0, 3).join(' ');
            return this.truncateText(topic, 20);
        }

        const words = (firstSentence.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])
            .filter((w) => !new Set(['please', 'help', 'about', 'with', 'this', 'that', 'what', 'how', 'why', 'when', 'where', 'the', 'and', 'for', 'can', 'you']).has(w));

        if (words.length > 0) {
            return this.truncateText(words.slice(0, 4).join(' '), 28);
        }

        return this.truncateText(firstSentence, 24);
    }

    private shouldAutoRenameConversation(title: string): boolean {
        const normalized = (title || '').trim();
        if (!normalized) return true;

        const lower = normalized.toLowerCase();
        if (lower === 'chat' || lower.startsWith('chat ')) return true;
        if (normalized === '会话' || normalized === '新会话') return true;
        if (/^会话\s*\d*$/.test(normalized)) return true;
        if (/^\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?$/.test(normalized)) return true;
        return false;
    }

    private handleStreamUpdate(text: string, messageId: string): void {
        if (!this.messagesContainer) return;

        if (!this.currentStreamingEl) {
            const streamMsg: ChatMessage = {
                id: messageId,
                role: 'assistant',
                content: text,
                timestamp: Date.now(),
                isStreaming: true,
            };
            this.currentStreamingEl = renderMessage(streamMsg, this.doc);
            this.messagesContainer.appendChild(this.currentStreamingEl);
        } else {
            updateStreamingMessage(this.currentStreamingEl, text, this.doc);
        }

        this.scrollToBottom();
    }

    private appendMessageEl(message: ChatMessage): void {
        if (!this.messagesContainer) return;
        const el = renderMessage(message, this.doc, {
            onUserResend: (text: string) => this.resendMessage(text),
        });
        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private getLastUserMessageText(): string | null {
        const messages = this.conversationManager.getActiveMessages();
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'user' && msg.content.trim()) {
                return msg.content;
            }
        }
        return null;
    }

    private resendMessage(text: string): void {
        if (!this.inputTextarea) return;
        if (this.service.busy) {
            this.updateStatus('正在生成中，请稍后重试');
            return;
        }

        this.inputTextarea.value = text;
        this.inputTextarea.style.height = 'auto';
        this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, 220)}px`;
        this.followNewest = true;
        void this.handleSend();
    }

    private createWelcomeEl(): HTMLElement {
        const wrap = this.doc.createElement('div');
        wrap.className = 'zeclau-welcome';

        const title = this.doc.createElement('div');
        title.className = 'zeclau-welcome-title';
        title.textContent = 'Hi, 我是 Zoclau';

        const subtitle = this.doc.createElement('div');
        subtitle.className = 'zeclau-welcome-subtitle';
        subtitle.textContent = '默认选择当前文献，\n或输入 @ 来引用当前文件夹中的论文。';

        wrap.appendChild(title);
        wrap.appendChild(subtitle);
        return wrap;
    }

    private applyQuickPrompt(prompt: string): void {
        if (!this.inputTextarea) return;
        this.inputTextarea.value = prompt;
        this.inputTextarea.style.height = 'auto';
        this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, 220)}px`;
        this.inputTextarea.focus();
    }

    private renderAllMessages(): void {
        if (!this.messagesContainer) return;
        this.messagesContainer.innerHTML = '';

        const messages = this.conversationManager.getActiveMessages();
        if (messages.length === 0) {
            this.messagesContainer.appendChild(this.createWelcomeEl());
            this.updateScrollButtonsState();
            return;
        }

        for (const msg of messages) {
            this.appendMessageEl(msg);
        }

        this.updateScrollButtonsState();
    }

    private ensureActiveConversation(): string {
        let convId = this.conversationManager.getActiveId();
        if (!convId) {
            const conv = this.conversationManager.create();
            convId = conv.id;
        }
        return convId;
    }

    private renderConversationOptions(): void {
        const activeId = this.ensureActiveConversation();
        const conversations = this.conversationManager.getAll();
        const activeConv = conversations.find((conv) => conv.id === activeId) || null;

        if (this.historyToggleBtn) {
            this.historyToggleBtn.title = activeConv
                ? `历史会话（当前：${activeConv.title}）`
                : '历史会话';
        }

        this.renderHistoryMenu(conversations, activeId);
    }

    private switchConversation(conversationId: string): void {
        if (!conversationId) return;
        const switched = this.conversationManager.switchTo(conversationId);
        if (!switched) return;

        this.followNewest = true;
        this.hideHistoryMenu();
        this.renderConversationOptions();
        this.renderAllMessages();
        this.updateStatus('就绪');
    }

    private newChat(): void {
        this.conversationManager.create();
        this.followNewest = true;
        this.hideHistoryMenu();
        this.renderConversationOptions();
        this.renderAllMessages();
        this.updateStatus('就绪');
        this.inputTextarea?.focus();
    }

    private renameActiveConversation(): void {
        const active = this.conversationManager.getActive();
        if (!active) return;

        const win = this.doc.defaultView as any;
        const initial = active.title || '';
        const next = String(win?.prompt?.('输入新的会话名称', initial) || '').trim();
        if (!next || next === initial) {
            return;
        }

        this.conversationManager.updateTitle(active.id, next.slice(0, 80));
        this.renderConversationOptions();
        this.updateStatus('会话已重命名');
    }

    private deleteCurrentConversation(): void {
        const activeId = this.conversationManager.getActiveId();
        if (!activeId) return;
        this.deleteConversationById(activeId, false);
    }

    private deleteConversationById(conversationId: string, keepHistoryMenuOpen: boolean): void {
        const target = this.conversationManager.getAll().find((conv) => conv.id === conversationId);
        if (!target) return;

        this.conversationManager.delete(conversationId);
        this.ensureActiveConversation();
        this.followNewest = true;

        if (!keepHistoryMenuOpen) {
            this.hideHistoryMenu();
        }

        this.renderConversationOptions();
        this.renderAllMessages();

        if (!keepHistoryMenuOpen) {
            this.updateStatus('会话已删除');
        }
    }

    private buildPromptWithContexts(userText: string): string {
        const mentionRegex = /@\[([^\]]+)\]/g;
        const titles: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = mentionRegex.exec(userText)) !== null) {
            const title = (match[1] || '').trim();
            if (title) {
                titles.push(title);
            }
        }

        const cleanText = userText
            .replace(/@\[[^\]]+\]/g, ' ')
            .replace(/(?:^|\s)@[^\s@\]]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const sections: string[] = [];

        const mergedContexts = new Map<string, ContextEntry>();
        if (this.selectedItemContext) {
            mergedContexts.set(this.selectedItemContext.key, this.selectedItemContext);
        }
        for (const ctx of this.selectedPaperContexts) {
            mergedContexts.set(ctx.key, ctx);
        }

        if (titles.length > 0) {
            const uniqueTitles = Array.from(new Set(titles));
            for (const ctx of this.resolveContextsByTitles(uniqueTitles)) {
                mergedContexts.set(ctx.key, ctx);
            }
        }

        const contexts = Array.from(mergedContexts.values());
        if (contexts.length > 0) {
            const blocks: string[] = [];
            for (let i = 0; i < contexts.length; i++) {
                const ctx = contexts[i];
                blocks.push(`[Context ${i + 1}] ${ctx.title}\n${ctx.content}`);
            }
            sections.push(`Reference Context (selected papers)\n${blocks.join('\n\n')}`);
        }

        const localFilesSection = this.buildLocalFileContextSection();
        if (localFilesSection) {
            sections.push(localFilesSection);
        }

        if (sections.length === 0) {
            return cleanText || userText;
        }

        return `${cleanText || userText}\n\n---\n${sections.join('\n\n')}\n---`;
    }

    private buildLocalFileContextSection(): string | null {
        if (this.selectedLocalFiles.length === 0) {
            return null;
        }

        const blocks = this.selectedLocalFiles.map((file, index) => {
            const lines: string[] = [
                `[Local File ${index + 1}] ${file.name}`,
                `Path: ${file.path}`,
                `Size: ${this.formatFileSize(file.size)}`,
            ];

            if (file.preview) {
                lines.push(`Preview:\n${file.preview}`);
            } else {
                lines.push('Preview: [Binary or unreadable file content omitted]');
            }

            return lines.join('\n');
        });

        return `Local File Context\n${blocks.join('\n\n')}`;
    }

    private formatFileSize(size: number): string {
        if (!Number.isFinite(size) || size <= 0) return 'Unknown';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    }

    private addSelectedPaperContext(ctx: ContextEntry): void {
        if (!ctx?.key) return;
        if (this.selectedItemContext?.key === ctx.key) {
            return;
        }
        if (this.selectedPaperContexts.some((item) => item.key === ctx.key)) {
            return;
        }

        this.selectedPaperContexts.push(ctx);
        this.renderSelectedPaperContexts();
        this.renderCurrentItemChip();
    }

    private removeSelectedPaperContext(key: string): void {
        this.selectedPaperContexts = this.selectedPaperContexts.filter((ctx) => ctx.key !== key);
        this.renderSelectedPaperContexts();
        this.renderCurrentItemChip();
    }

    private renderSelectedPaperContexts(): void {
        if (!this.selectedContextWrap) return;

        this.selectedContextWrap.innerHTML = '';

        for (const ctx of this.selectedPaperContexts) {
            const chip = this.doc.createElement('span');
            chip.className = 'zeclau-paper-chip';
            chip.title = ctx.title;

            const label = this.doc.createElement('span');
            label.className = 'zeclau-paper-chip-label';
            label.textContent = this.truncateText(ctx.title, 30);

            const removeBtn = this.doc.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'zeclau-paper-chip-remove';
            removeBtn.textContent = '×';
            removeBtn.title = '移除论文';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.removeSelectedPaperContext(ctx.key);
            });

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            this.selectedContextWrap.appendChild(chip);
        }

        // Keep the "current paper" chip state in sync with @-added paper chips.
        this.renderCurrentItemChip();
    }

    private pickLocalFiles(): void {
        try {
            const Cc = Components.classes;
            const Ci = Components.interfaces;
            const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
            picker.init(this.doc.defaultView, '选择本地文件夹', Ci.nsIFilePicker.modeGetFolder);

            const consumeResult = (rv: number): void => {
                if (rv !== Ci.nsIFilePicker.returnOK && rv !== Ci.nsIFilePicker.returnReplace) {
                    return;
                }

                const folder = picker.file;
                if (!folder || (typeof folder.isDirectory === 'function' && !folder.isDirectory())) {
                    this.updateStatus('未选择有效文件夹');
                    return;
                }

                const files = this.collectReadableFilesFromFolder(folder, 24);
                if (files.length === 0) {
                    this.updateStatus('该文件夹中未找到可读取文本文件');
                    return;
                }

                const incoming: LocalFileEntry[] = [];
                for (const file of files) {
                    try {
                        const path = String(file.path);
                        const name = String(file.leafName || this.extractFileName(path));
                        const size = Number(file.fileSize || 0);
                        const preview = this.readLocalFilePreview(path, 16 * 1024);
                        incoming.push({ path, name, size, preview });
                    } catch {
                        // ignore single file failures
                    }
                }

                const merged = new Map<string, LocalFileEntry>();
                for (const file of this.selectedLocalFiles) {
                    merged.set(file.path, file);
                }
                for (const file of incoming) {
                    merged.set(file.path, file);
                }

                this.selectedLocalFiles = Array.from(merged.values()).slice(0, 12);
                this.renderSelectedLocalFiles();
                this.updateStatus(`已添加 ${incoming.length} 个文件`);
            };

            if (typeof picker.open === 'function') {
                picker.open((rv: number) => consumeResult(rv));
            } else {
                consumeResult(picker.show());
            }
        } catch (e) {
            this.updateStatus('选择文件夹失败');
            try {
                Zotero.debug(`[Zoclau] Failed to pick local folder: ${e}`);
            } catch {
                // ignore
            }
        }
    }

    private collectReadableFilesFromFolder(folder: any, maxFiles: number): any[] {
        const out: any[] = [];
        const queue: any[] = [folder];
        const allowedExt = new Set([
            'txt', 'md', 'markdown', 'json', 'csv', 'log', 'ini', 'yml', 'yaml',
            'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
            'html', 'css', 'xml', 'tex', 'rst', 'org', 'sh', 'ps1',
        ]);

        try {
            const Ci = Components.interfaces;
            while (queue.length > 0 && out.length < maxFiles) {
                const dir = queue.shift();
                if (!dir || typeof dir.directoryEntries === 'undefined') {
                    continue;
                }

                const entries = dir.directoryEntries;
                while (entries.hasMoreElements() && out.length < maxFiles) {
                    const entry = entries.getNext().QueryInterface(Ci.nsIFile);
                    if (!entry || !entry.exists()) continue;
                    if (typeof entry.isHidden === 'function' && entry.isHidden()) continue;

                    if (entry.isDirectory()) {
                        queue.push(entry);
                        continue;
                    }

                    const ext = String(entry.leafName || '').split('.').pop()?.toLowerCase() || '';
                    if (!allowedExt.has(ext)) {
                        continue;
                    }

                    out.push(entry);
                }
            }
        } catch {
            // ignore traversal errors
        }

        return out;
    }

    private renderSelectedLocalFiles(): void {
        if (!this.localFilesWrap) return;

        this.localFilesWrap.innerHTML = '';

        for (const file of this.selectedLocalFiles) {
            const chip = this.doc.createElement('span');
            chip.className = 'zeclau-local-file-chip';
            chip.title = file.path;

            const label = this.doc.createElement('span');
            label.className = 'zeclau-local-file-label';
            label.textContent = this.truncateText(file.name, 26);

            const removeBtn = this.doc.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'zeclau-local-file-remove';
            removeBtn.textContent = '×';
            removeBtn.title = '移除文件';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.removeLocalFile(file.path);
            });

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            this.localFilesWrap.appendChild(chip);
        }
    }

    private removeLocalFile(path: string): void {
        this.selectedLocalFiles = this.selectedLocalFiles.filter((file) => file.path !== path);
        this.renderSelectedLocalFiles();
    }

    private readLocalFilePreview(path: string, maxBytes: number): string {
        try {
            const Cc = Components.classes;
            const Ci = Components.interfaces;
            const nsFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
            nsFile.initWithPath(path);
            if (!nsFile.exists() || nsFile.isDirectory()) {
                return '';
            }

            const fileInput = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
            fileInput.init(nsFile, 0x01, 0, 0);

            const binaryInput = Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream);
            binaryInput.setInputStream(fileInput);

            const available = Math.min(maxBytes, binaryInput.available());
            const byteArray = binaryInput.readByteArray(available) as number[];

            binaryInput.close();
            fileInput.close();

            const bytes = Uint8Array.from(byteArray);
            if (this.looksBinaryData(bytes)) {
                return '';
            }

            let text = '';
            try {
                text = new TextDecoder('utf-8').decode(bytes);
            } catch {
                text = Array.from(bytes).slice(0, 2048).map((b) => String.fromCharCode(b)).join('');
            }

            const compact = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
            if (!compact) return '';
            return compact.length > 1800 ? `${compact.slice(0, 1800)}...` : compact;
        } catch {
            return '';
        }
    }

    private looksBinaryData(bytes: Uint8Array): boolean {
        if (bytes.length === 0) return false;

        const sample = bytes.slice(0, Math.min(bytes.length, 512));
        let suspicious = 0;

        for (const value of sample) {
            if (value === 0) {
                return true;
            }
            const isControl = value < 9 || (value > 13 && value < 32);
            if (isControl) {
                suspicious += 1;
            }
        }

        return suspicious / sample.length > 0.22;
    }

    private extractFileName(path: string): string {
        const parts = path.split(/[\\/]/g).filter((part) => part.length > 0);
        return parts.length > 0 ? parts[parts.length - 1] : path;
    }

    private getZoteroPane(): any {
        const win = this.doc.defaultView as any;
        if (win?.ZoteroPane) return win.ZoteroPane;

        try {
            const mainWin = Zotero?.getMainWindow?.();
            if (mainWin?.ZoteroPane) return mainWin.ZoteroPane;
        } catch {
            // ignore
        }

        return null;
    }

    private getFolderCandidateContexts(): ContextEntry[] {
        const now = Date.now();
        if (now - this.mentionCacheAt < 4000 && this.mentionCache.length > 0) {
            return this.mentionCache;
        }

        const pane = this.getZoteroPane();
        if (!pane) {
            this.mentionCache = [];
            this.mentionCacheAt = now;
            return [];
        }

        const toArray = (value: any): any[] => {
            if (!value) return [];
            if (Array.isArray(value)) return value;
            try {
                return Array.from(value as any);
            } catch {
                return [];
            }
        };

        let items: any[] = [];

        if (typeof pane.getSortedItems === 'function') {
            for (const mode of [false, true] as const) {
                try {
                    const next = toArray(pane.getSortedItems(mode));
                    if (next.length > 0) {
                        items = next;
                        break;
                    }
                } catch {
                    // ignore and try next mode
                }
            }

            if (items.length === 0) {
                try {
                    items = toArray(pane.getSortedItems());
                } catch {
                    // ignore
                }
            }
        }

        if (items.length === 0 && typeof pane.getSelectedItems === 'function') {
            try {
                items = toArray(pane.getSelectedItems());
            } catch {
                // ignore
            }
        }

        const resolveItem = (raw: any): any => {
            if (!raw) return null;
            if ((typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) && Zotero?.Items?.get) {
                try {
                    return Zotero.Items.get(Number(raw));
                } catch {
                    return null;
                }
            }
            if (typeof raw === 'object' && typeof raw.isRegularItem !== 'function' && typeof raw.id === 'number' && Zotero?.Items?.get) {
                try {
                    return Zotero.Items.get(raw.id) || raw;
                } catch {
                    return raw;
                }
            }
            return raw;
        };

        const contexts: ContextEntry[] = [];
        for (const raw of items) {
            const item = resolveItem(raw);
            if (!item) continue;

            try {
                if (typeof item?.isRegularItem === 'function' && !item.isRegularItem()) {
                    continue;
                }
            } catch {
                // ignore
            }

            const ctx = this.extractItemContext(item);
            if (ctx) contexts.push(ctx);
            if (contexts.length >= 200) break;
        }

        this.mentionCache = contexts;
        this.mentionCacheAt = now;
        return contexts;
    }

    private resolveContextsByTitles(titles: string[]): ContextEntry[] {
        const byTitle = new Map<string, ContextEntry>();
        for (const ctx of this.getFolderCandidateContexts()) {
            byTitle.set(ctx.title, ctx);
        }

        const out: ContextEntry[] = [];
        const used = new Set<string>();
        for (const title of titles) {
            const ctx = byTitle.get(title);
            if (!ctx || used.has(ctx.key)) continue;
            used.add(ctx.key);
            out.push(ctx);
        }

        return out;
    }
    private updateMentionDropdown(): void {
        if (!this.inputTextarea || !this.mentionDropdown) return;

        const value = this.inputTextarea.value;
        const caret = this.inputTextarea.selectionStart || 0;
        const before = value.slice(0, caret);
        const match = before.match(/(?:^|\s)@([^\s@\]]*)$/);

        if (!match) {
            this.hideMentionDropdown();
            return;
        }

        const rawQuery = (match[1] || '').trim().toLowerCase();
        const contexts = this.getFolderCandidateContexts();
        const filtered = contexts.filter((ctx) => {
            if (!rawQuery) return true;
            return ctx.title.toLowerCase().includes(rawQuery);
        });

        if (filtered.length === 0) {
            this.hideMentionDropdown();
            return;
        }

        this.currentMentionRange = {
            start: caret - match[0].trimStart().length,
            end: caret,
        };
        this.mentionMatches = filtered;
        this.mentionActiveIndex = 0;
        this.renderMentionDropdown();
    }

    private renderMentionDropdown(): void {
        if (!this.mentionDropdown) return;

        this.mentionDropdown.innerHTML = '';
        this.mentionDropdown.style.display = 'block';

        this.mentionMatches.forEach((ctx, index) => {
            const item = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
            item.type = 'button';
            item.style.display = 'block';
            item.style.width = '100%';
            item.style.margin = '0';
            item.className = 'zeclau-mention-item';
            if (index === this.mentionActiveIndex) {
                item.classList.add('is-active');
            }
            const isSelected = this.selectedPaperContexts.some((paper) => paper.key === ctx.key) || this.selectedItemContext?.key === ctx.key;
            if (isSelected) {
                item.classList.add('is-selected');
            }
            item.textContent = `@${ctx.title}`;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.applyMention(ctx);
            });
            this.mentionDropdown!.appendChild(item);
        });
        this.mentionDropdown.style.removeProperty('width');
        this.mentionDropdown.style.removeProperty('left');
        this.mentionDropdown.style.removeProperty('top');
        this.mentionDropdown.style.removeProperty('right');
        this.mentionDropdown.style.removeProperty('bottom');
    }

    private positionMentionDropdownNearAt(): void {
        if (!this.inputTextarea || !this.mentionDropdown) return;
        const parent = this.mentionDropdown.parentElement as HTMLElement | null;
        if (!parent) return;

        const atPos = this.currentMentionRange
            ? Math.max(0, this.currentMentionRange.start + 1)
            : (this.inputTextarea.selectionStart || 0);
        const caret = this.getTextareaCaretCoordinates(this.inputTextarea, atPos);

        const shellWidth = Math.max(120, parent.clientWidth);
        const baseWidth = Math.min(360, Math.max(220, shellWidth - 16));
        const dropdownWidth = Math.max(160, Math.round(baseWidth * 0.75));
        this.mentionDropdown.style.setProperty('width', `${dropdownWidth}px`, 'important');

        const dropdownHeight = Math.max(40, this.mentionDropdown.offsetHeight || 0);
        let left = Math.round(caret.left + 8);
        left = Math.min(left, Math.max(8, shellWidth - dropdownWidth - 8));
        left = Math.max(8, left);
        const belowTop = Math.round(caret.top + caret.lineHeight + 30);
        const aboveTop = Math.round(caret.top - dropdownHeight - 8);
        const top = belowTop + dropdownHeight <= parent.clientHeight - 6 ? belowTop : Math.max(8, aboveTop);

        this.mentionDropdown.style.setProperty('left', `${left}px`, 'important');
        this.mentionDropdown.style.setProperty('top', `${top}px`, 'important');
        this.mentionDropdown.style.setProperty('right', 'auto', 'important');
        this.mentionDropdown.style.setProperty('bottom', 'auto', 'important');
    }

    private getTextareaCaretCoordinates(
        textarea: HTMLTextAreaElement,
        position: number,
    ): { left: number; top: number; lineHeight: number } {
        const mirror = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
        const style = this.doc.defaultView?.getComputedStyle(textarea);

        const copy = (name: string): void => {
            if (style) {
                mirror.style.setProperty(name, style.getPropertyValue(name));
            }
        };

        [
            'font-family',
            'font-size',
            'font-style',
            'font-weight',
            'letter-spacing',
            'text-transform',
            'word-spacing',
            'text-indent',
            'line-height',
            'padding-top',
            'padding-right',
            'padding-bottom',
            'padding-left',
            'border-top-width',
            'border-right-width',
            'border-bottom-width',
            'border-left-width',
            'box-sizing',
            'white-space',
            'word-wrap',
            'overflow-wrap',
        ].forEach(copy);

        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.pointerEvents = 'none';
        mirror.style.left = '0';
        mirror.style.top = '0';
        mirror.style.width = `${textarea.clientWidth}px`;
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.overflowWrap = 'break-word';

        const safePos = Math.max(0, Math.min(position, textarea.value.length));
        const before = textarea.value.slice(0, safePos);
        const after = textarea.value.slice(safePos) || ' ';

        mirror.textContent = before;
        const marker = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'span') as HTMLElement;
        marker.textContent = after[0];
        mirror.appendChild(marker);

        const host = textarea.parentElement || this.mentionDropdown?.parentElement;
        if (host) {
            host.appendChild(mirror);
        } else {
            this.doc.documentElement.appendChild(mirror);
        }

        const left = marker.offsetLeft - textarea.scrollLeft;
        const top = marker.offsetTop - textarea.scrollTop;
        const lineHeight = style ? parseFloat(style.lineHeight || '') : NaN;

        mirror.remove();

        return {
            left: Number.isFinite(left) ? left : 0,
            top: Number.isFinite(top) ? top : 0,
            lineHeight: Number.isFinite(lineHeight) ? lineHeight : 18,
        };
    }

    private moveMentionSelection(delta: number): void {
        if (!this.mentionDropdown || this.mentionMatches.length === 0) return;
        const len = this.mentionMatches.length;
        this.mentionActiveIndex = (this.mentionActiveIndex + delta + len) % len;
        this.renderMentionDropdown();
    }

    private applyMention(ctx: ContextEntry): void {
        if (this.inputTextarea && this.currentMentionRange) {
            const value = this.inputTextarea.value;
            const start = this.currentMentionRange.start;
            const end = this.currentMentionRange.end;
            this.inputTextarea.value = (value.slice(0, start) + value.slice(end)).replace(/\s{2,}/g, ' ');
            this.inputTextarea.setSelectionRange(start, start);
            this.inputTextarea.focus();
            this.inputTextarea.style.height = 'auto';
            this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, 220)}px`;
        }

        this.addSelectedPaperContext(ctx);
        this.hideMentionDropdown();
    }

    private insertContextMention(ctx: ContextEntry, replaceRange?: { start: number; end: number } | null): void {
        if (!this.inputTextarea) return;

        const value = this.inputTextarea.value;
        const mentionText = `@[${ctx.title}] `;

        let start = this.inputTextarea.selectionStart || value.length;
        let end = this.inputTextarea.selectionEnd || value.length;
        if (replaceRange) {
            start = replaceRange.start;
            end = replaceRange.end;
        }

        const needsSpace = start > 0 && !/\s/.test(value[start - 1]);
        const insertion = replaceRange ? mentionText : `${needsSpace ? ' ' : ''}${mentionText}`;

        this.inputTextarea.value =
            value.slice(0, start) +
            insertion +
            value.slice(end);

        const cursor = start + insertion.length;
        this.inputTextarea.setSelectionRange(cursor, cursor);
        this.inputTextarea.focus();
        this.inputTextarea.style.height = 'auto';
        this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, 220)}px`;
    }

    private triggerMentionPicker(): void {
        if (!this.inputTextarea) return;

        this.inputTextarea.focus();
        const caret = this.inputTextarea.selectionStart || this.inputTextarea.value.length;
        const contexts = this.getFolderCandidateContexts();

        if (contexts.length === 0) {
            this.hideMentionDropdown();
            this.updateStatus('当前文件夹没有可引用的论文');
            return;
        }

        this.currentMentionRange = { start: caret, end: caret };
        this.mentionMatches = contexts;
        this.mentionActiveIndex = 0;
        this.renderMentionDropdown();
    }

    private renderCurrentItemChip(): void {
        if (!this.currentItemChip) return;

        const group = this.currentItemChip.parentElement as HTMLElement | null;
        const setGroupHidden = (hidden: boolean): void => {
            if (!group) return;
            group.classList.toggle('zeclau-current-item-group-hidden', hidden);
        };

        // If papers are already selected, hide the placeholder chip row entirely.
        if (this.selectedPaperContexts.length > 0 && !this.selectedItemContext) {
            setGroupHidden(true);
            if (this.currentItemClearBtn) {
                this.currentItemClearBtn.style.display = 'none';
            }
            return;
        }

        setGroupHidden(false);

        const samplePaperChip = this.selectedContextWrap?.querySelector('.zeclau-paper-chip') as HTMLElement | null;
        if (samplePaperChip && group) {
            const view = this.doc.defaultView;
            const sampleStyle = view ? view.getComputedStyle(samplePaperChip) : null;
            const sampleRect = samplePaperChip.getBoundingClientRect();
            if (sampleStyle && sampleRect.width > 0) {
                const widthPx = Math.round(sampleRect.width) + "px";
                group.style.setProperty('width', widthPx, 'important');
                group.style.setProperty('min-width', widthPx, 'important');
                group.style.setProperty('max-width', widthPx, 'important');

                this.currentItemChip.style.setProperty('display', 'block');
                this.currentItemChip.style.setProperty('box-sizing', sampleStyle.boxSizing || 'border-box');
                this.currentItemChip.style.setProperty('width', '100%');
                this.currentItemChip.style.setProperty('min-width', '100%');
                this.currentItemChip.style.setProperty('max-width', '100%');
                this.currentItemChip.style.setProperty('min-height', sampleStyle.minHeight || '24px');
                this.currentItemChip.style.setProperty('padding-top', sampleStyle.paddingTop || '4px');
                this.currentItemChip.style.setProperty('padding-right', sampleStyle.paddingRight || '30px');
                this.currentItemChip.style.setProperty('padding-bottom', sampleStyle.paddingBottom || '4px');
                this.currentItemChip.style.setProperty('padding-left', sampleStyle.paddingLeft || '10px');
                this.currentItemChip.style.setProperty('border', sampleStyle.border || '1px solid #c8d6ef');
                this.currentItemChip.style.setProperty('border-radius', sampleStyle.borderRadius || '999px');
                this.currentItemChip.style.setProperty('font-size', sampleStyle.fontSize || '10.5px');
                this.currentItemChip.style.setProperty('line-height', sampleStyle.lineHeight || '1.2');
            }
        }

        if (this.selectedItemContext) {
            const title = this.selectedItemContext.title;
            this.currentItemChip.textContent = this.truncateText(title, 36);
            this.currentItemChip.title = `${title}\n\u70b9\u51fb\u63d2\u5165\u4e3a\u8bba\u6587\u4e0a\u4e0b\u6587`;
            this.currentItemChip.classList.remove('is-empty');
            if (this.currentItemClearBtn) {
                this.currentItemClearBtn.style.display = 'inline-flex';
            }
            return;
        }

        this.currentItemChip.textContent = '\u5f53\u524d\u6587\u732e\uff08\u672a\u6dfb\u52a0\uff09';
        this.currentItemChip.title = '\u70b9\u51fb\u53ef\u4ece\u5f53\u524d\u6587\u4ef6\u5939\u4e2d\u9009\u62e9\u8bba\u6587';
        this.currentItemChip.classList.add('is-empty');
        if (this.currentItemClearBtn) {
            this.currentItemClearBtn.style.display = 'none';
        }
    }

    private truncateText(text: string, max: number): string {
        if (text.length <= max) return text;
        return `${text.slice(0, Math.max(0, max - 1))}…`;
    }

    private hideMentionDropdown(): void {
        if (this.mentionDropdown) {
            this.mentionDropdown.style.display = 'none';
            this.mentionDropdown.innerHTML = '';
        }
        this.mentionMatches = [];
        this.currentMentionRange = null;
        this.mentionActiveIndex = 0;
    }
    private extractItemContext(item: any): ContextEntry | null {
        if (!item) return null;

        try {
            const title = String(item.getField?.('title') || item.getDisplayTitle?.() || item.title || '未命名');
            const year = String(item.getField?.('year') || item.getField?.('date') || '').trim();

            const creators = typeof item.getCreators === 'function' ? item.getCreators() : [];
            const authors = Array.isArray(creators)
                ? creators
                    .slice(0, 5)
                    .map((creator: any) => {
                        const first = creator?.firstName ? String(creator.firstName).trim() : '';
                        const last = creator?.lastName ? String(creator.lastName).trim() : '';
                        const combined = `${first} ${last}`.trim();
                        return combined || String(creator?.name || '').trim();
                    })
                    .filter((x: string) => x.length > 0)
                : [];

            const abstract = String(item.getField?.('abstractNote') || '').replace(/\s+/g, ' ').trim();
            const tags = typeof item.getTags === 'function'
                ? (item.getTags() || []).map((tag: any) => String(tag?.tag || '').trim()).filter((x: string) => x)
                : [];

            const parts: string[] = [`Title: ${title}`];
            if (authors.length > 0) parts.push(`Authors: ${authors.join(', ')}`);
            if (year) parts.push(`Year: ${year}`);
            if (abstract) parts.push(`Abstract: ${abstract}`);
            if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`);

            const key = item.key ? `item:${String(item.key)}` : `title:${title}`;

            return {
                key,
                title,
                content: parts.join('\n'),
            };
        } catch {
            return null;
        }
    }

    private setInputEnabled(enabled: boolean): void {
        if (this.inputTextarea) {
            this.inputTextarea.disabled = !enabled;
        }
        if (this.sendButton) {
            this.sendButton.disabled = !enabled;
        }
    }

    private setLiveState(state: 'ready' | 'thinking' | 'error'): void {
        if (!this.statusDot) return;
        this.statusDot.classList.remove('zeclau-live-dot-thinking', 'zeclau-live-dot-error');
        if (state === 'thinking') {
            this.statusDot.classList.add('zeclau-live-dot-thinking');
        } else if (state === 'error') {
            this.statusDot.classList.add('zeclau-live-dot-error');
        }
    }

    private scrollToBottom(force = false): void {
        if (!this.messagesContainer) return;
        if (!force && (!this.enableAutoScroll || !this.followNewest)) {
            this.updateScrollButtonsState();
            return;
        }

        this.followNewest = true;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        this.updateScrollButtonsState();
    }

    private updateStatus(text: string): void {
        if (this.statusBar) {
            this.statusBar.textContent = text;
        }
    }

    destroy(): void {
        if (this.docClickHandler) {
            this.doc.removeEventListener('mousedown', this.docClickHandler);
            this.docClickHandler = null;
        }

        this.container.innerHTML = '';
        this.messagesWrapper = null;
        this.messagesContainer = null;
        this.inputTextarea = null;
        this.sendButton = null;
        this.stopButton = null;
        this.modelSelector = null;
        this.statusBar = null;
        this.statusDot = null;
        this.conversationTitleBtn = null;
        this.historyToggleBtn = null;
        this.historyMenu = null;
        this.currentItemChip = null;
        this.localFilesWrap = null;
        this.scrollRail = null;
        this.scrollTopBtn = null;
        this.scrollBottomBtn = null;
        this.mentionDropdown = null;
        this.currentStreamingEl = null;
        this.mentionActiveIndex = 0;
        this.mentionMatches = [];
        this.currentMentionRange = null;
        this.mentionCache = [];
        this.mentionCacheAt = 0;
        this.selectedLocalFiles = [];
    }
}







































































