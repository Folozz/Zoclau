
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
    folderPath: string;
}

const DEFAULT_MODELS: { value: ClaudeModel; label: string }[] = [
    { value: 'auto', label: '自动（使用 Claude 设置）' },
    { value: 'haiku', label: 'Haiku（快速）' },
    { value: 'sonnet', label: 'Sonnet（均衡）' },
    { value: 'opus', label: 'Opus（强大）' },
];

const BASE_MESSAGES_HEIGHT_PX = 480;
const MAX_INPUT_TEXTAREA_HEIGHT_PX = 220;
const MAX_LOCAL_FILES_PER_FOLDER = 6;

export class ChatPanel {
    private doc: Document;
    private container: HTMLElement;
    private service: ClaudeService;
    private conversationManager: ConversationManager;
    private settings: any;

    // DOM
    private messagesWrapper: HTMLElement | null = null;
    private messagesContainer: HTMLElement | null = null;
    private inputArea: HTMLElement | null = null;
    private inputTextarea: HTMLTextAreaElement | null = null;
    private sendButton: HTMLButtonElement | null = null;
    private stopButton: HTMLButtonElement | null = null;
    private modelSelector: HTMLSelectElement | null = null;
    private statusBar: HTMLElement | null = null;
    private statusDot: HTMLElement | null = null;
    private composerToolbar: HTMLElement | null = null;
    private conversationTitleBtn: HTMLButtonElement | null = null;
    private historyToggleBtn: HTMLButtonElement | null = null;
    private historyMenu: HTMLElement | null = null;
    private currentItemChip: HTMLButtonElement | null = null;
    private currentItemClearBtn: HTMLButtonElement | null = null;
    private selectedContextWrap: HTMLElement | null = null;
    private localFilesWrap: HTMLElement | null = null;
    private folderPickerBtn: HTMLButtonElement | null = null;
    private folderCountBadge: HTMLElement | null = null;
    private externalContextMenu: HTMLElement | null = null;
    private scrollRail: HTMLElement | null = null;
    private scrollTopBtn: HTMLButtonElement | null = null;
    private scrollBottomBtn: HTMLButtonElement | null = null;
    private mentionDropdown: HTMLElement | null = null;
    private docClickHandler: ((event: MouseEvent) => void) | null = null;
    private inputAreaResizeObserver: ResizeObserver | null = null;
    private externalContextHideTimer: number | null = null;

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
    private selectedLocalFolders: string[] = [];
    private selectedPaperContexts: ContextEntry[] = [];
    private historyMenuRowHeight = 44;
    private inputAreaBaseHeight = 0;
    private historyActiveIndex = -1;
    private slashMode = false;
    private skillCache: { name: string; fullName: string }[] = [];
    private skillCacheAt = 0;

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
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.flex = '1 1 auto';
        this.container.style.height = '100%';
        this.container.style.maxHeight = '100%';
        this.container.style.minHeight = '0';
        this.container.style.overflow = 'hidden';
        this.container.style.position = 'relative';

        this.messagesWrapper = this.doc.createElement('div');
        this.messagesWrapper.className = 'zeclau-messages-wrapper';
        const baseMessagesHeight = `${BASE_MESSAGES_HEIGHT_PX}px`;
        this.messagesWrapper.style.setProperty('height', baseMessagesHeight, 'important');
        this.messagesWrapper.style.setProperty('min-height', baseMessagesHeight, 'important');
        this.messagesWrapper.style.setProperty('max-height', baseMessagesHeight, 'important');
        this.messagesWrapper.style.setProperty('flex', `0 0 ${baseMessagesHeight}`, 'important');
        this.messagesWrapper.style.minHeight = '0';
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

        const inputArea = this.buildInputArea();
        this.inputArea = inputArea;

        this.container.appendChild(this.messagesWrapper);
        this.container.appendChild(inputArea);

        if (!this.callbacksWired) {
            this.wireCallbacks();
            this.callbacksWired = true;
        }

        this.ensureActiveConversation();
        this.renderConversationOptions();
        this.renderCurrentItemChip();
        this.renderAllMessages();
        this.resizeInputTextarea();
        this.attachInputAreaResizeObserver();
        this.syncFixedPanelLayout(true);
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
        this.inputArea = inputArea;

        const toolbar = this.doc.createElement('div');
        toolbar.className = 'zeclau-composer-toolbar';
        this.composerToolbar = toolbar;
        this.composerToolbar.classList.add('zeclau-history-wrap');
        this.ensureHistoryMenu();

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

            if (this.historyMenu && this.historyMenu.style.display !== 'none') {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveHistorySelection(1);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveHistorySelection(-1);
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.selectHistoryActiveConversation();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.hideHistoryMenu();
                    return;
                }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void this.handleSend();
            }
        });
        this.inputTextarea.addEventListener('input', () => {
            this.resizeInputTextarea();
            this.updateMentionDropdown();
            this.updateSlashCommandDropdown();
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

        const newBtnFooter = this.doc.createElement('button');
        newBtnFooter.type = 'button';
        newBtnFooter.className = 'zeclau-icon-btn zeclau-toolbar-btn zeclau-toolbar-btn-new';
        newBtnFooter.title = '新建会话';
        newBtnFooter.appendChild(this.createToolbarIcon('new'));
        newBtnFooter.addEventListener('click', () => this.newChat());

        const addFolderBtn = this.doc.createElement('button');
        addFolderBtn.type = 'button';
        addFolderBtn.className = 'zeclau-icon-btn zeclau-file-picker-btn zeclau-toolbar-btn zeclau-toolbar-btn-folder';
        addFolderBtn.title = '选择本地文件夹';
        addFolderBtn.appendChild(this.createToolbarIcon('folder'));
        const folderCountBadge = this.doc.createElement('span');
        folderCountBadge.className = 'zeclau-folder-count-badge';
        folderCountBadge.style.display = 'none';
        addFolderBtn.appendChild(folderCountBadge);
        addFolderBtn.addEventListener('mouseenter', () => this.showExternalContextMenu());
        addFolderBtn.addEventListener('focus', () => this.showExternalContextMenu());
        addFolderBtn.addEventListener('mouseleave', () => this.scheduleHideExternalContextMenu());
        addFolderBtn.addEventListener('click', () => this.pickLocalFiles());
        this.folderPickerBtn = addFolderBtn;
        this.folderCountBadge = folderCountBadge;

        footerLeft.appendChild(newBtnFooter);
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

        this.externalContextMenu = this.doc.createElement('div');
        this.externalContextMenu.className = 'zeclau-external-context-menu';
        this.externalContextMenu.style.display = 'none';
        this.externalContextMenu.addEventListener('mouseenter', () => this.clearExternalContextHideTimer());
        this.externalContextMenu.addEventListener('mouseleave', () => this.scheduleHideExternalContextMenu());
        shell.appendChild(this.externalContextMenu);

        if (!this.docClickHandler) {
            this.docClickHandler = (event: MouseEvent) => {
                const target = event.target as Node | null;
                if (!target) return;

                if (this.historyMenu) {
                    const clickedToggle = this.historyToggleBtn?.contains(target) || false;
                    const clickedMenu = this.historyMenu.contains(target);

                    if (!clickedToggle && !clickedMenu) {
                        this.hideHistoryMenu();
                    }
                }

                const clickedFolderBtn = this.folderPickerBtn?.contains(target) || false;
                const clickedExternalMenu = this.externalContextMenu?.contains(target) || false;
                if (!clickedFolderBtn && !clickedExternalMenu) {
                    this.hideExternalContextMenu();
                }
            };
            this.doc.addEventListener('mousedown', this.docClickHandler);
        }

        this.renderCurrentItemChip();
        this.renderSelectedPaperContexts();
        this.renderSelectedLocalFiles();
        this.renderExternalContextMenu();
        return inputArea;
    }

    private resizeInputTextarea(): void {
        if (!this.inputTextarea) return;
        this.inputTextarea.style.height = 'auto';
        this.inputTextarea.style.height = `${Math.min(this.inputTextarea.scrollHeight, MAX_INPUT_TEXTAREA_HEIGHT_PX)}px`;
        this.syncFixedPanelLayout();
    }

    private attachInputAreaResizeObserver(): void {
        if (this.inputAreaResizeObserver) {
            this.inputAreaResizeObserver.disconnect();
            this.inputAreaResizeObserver = null;
        }

        const ResizeObserverCtor = this.doc.defaultView?.ResizeObserver;
        if (!ResizeObserverCtor || !this.inputArea) {
            return;
        }

        this.inputAreaResizeObserver = new ResizeObserverCtor(() => {
            this.syncFixedPanelLayout();
        });
        this.inputAreaResizeObserver.observe(this.inputArea);
    }

    private syncFixedPanelLayout(resetBase = false): void {
        if (!this.messagesWrapper || !this.inputArea) return;

        const inputHeight = Math.round(this.inputArea.getBoundingClientRect().height);
        if (!Number.isFinite(inputHeight) || inputHeight <= 0) {
            return;
        }

        if (resetBase || this.inputAreaBaseHeight <= 0) {
            this.inputAreaBaseHeight = inputHeight;
        }

        const inputDelta = Math.max(0, inputHeight - this.inputAreaBaseHeight);
        const messagesHeight = Math.max(0, BASE_MESSAGES_HEIGHT_PX - inputDelta);
        const px = `${messagesHeight}px`;

        this.messagesWrapper.style.setProperty('height', px, 'important');
        this.messagesWrapper.style.setProperty('min-height', px, 'important');
        this.messagesWrapper.style.setProperty('max-height', px, 'important');
        this.messagesWrapper.style.setProperty('flex', `0 0 ${px}`, 'important');
    }

    private ensureHistoryMenu(): void {
        if (this.historyMenu) return;
        if (!this.container) return;

        this.historyMenu = this.doc.createElement('div');
        this.historyMenu.className = 'zeclau-history-menu';
        this.historyMenu.style.display = 'none';
        this.container.appendChild(this.historyMenu);
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
        this.ensureHistoryMenu();
        if (!this.historyMenu) return;
        const showing = this.historyMenu.style.display !== 'none';
        if (showing) {
            this.historyMenu.style.display = 'none';
            return;
        }

        this.showHistoryMenu();
    }

    private hideHistoryMenu(): void {
        if (this.historyMenu) {
            this.historyMenu.style.display = 'none';
        }
    }

    private showHistoryMenu(): void {
        this.ensureHistoryMenu();
        if (!this.historyMenu) return;

        this.historyActiveIndex = -1;
        // Position above input area, aligned to input area width
        const inputEl = this.container.querySelector('.zeclau-input-area') as HTMLElement | null;
        const bottomPx = inputEl ? inputEl.getBoundingClientRect().height + 16 : 60;
        this.historyMenu.style.position = 'absolute';
        this.historyMenu.style.bottom = `${bottomPx}px`;
        this.historyMenu.style.zIndex = '52';
        this.historyMenu.style.display = 'block';

        // Align left/right to input area with small inset
        if (inputEl) {
            const containerRect = this.container.getBoundingClientRect();
            const inputRect = inputEl.getBoundingClientRect();
            const left = inputRect.left - containerRect.left + 4;
            const right = containerRect.right - inputRect.right + 4;
            this.historyMenu.style.left = `${left}px`;
            this.historyMenu.style.right = `${right}px`;
        } else {
            this.historyMenu.style.left = '4px';
            this.historyMenu.style.right = '4px';
        }
        const win = this.doc.defaultView;
        if (win && typeof win.requestAnimationFrame === 'function') {
            win.requestAnimationFrame(() => this.syncHistoryMenuHeightFromVisibleRow());
        } else {
            this.syncHistoryMenuHeightFromVisibleRow();
        }
        this.ensureHistorySelection();
    }

    private updateSlashCommandDropdown(): void {
        if (!this.inputTextarea) return;

        if (this.isHistoryCommandInput(this.inputTextarea.value)) {
            this.hideMentionDropdown();
            this.renderConversationOptions();
            this.showHistoryMenu();
            return;
        }

        this.hideHistoryMenu();
    }

    private getHistoryMenuItems(): HTMLButtonElement[] {
        if (!this.historyMenu) return [];
        return Array.from(this.historyMenu.querySelectorAll('.zeclau-history-item')) as HTMLButtonElement[];
    }

    private ensureHistorySelection(): void {
        const items = this.getHistoryMenuItems();
        if (items.length === 0) {
            this.historyActiveIndex = -1;
            return;
        }

        if (this.historyActiveIndex < 0 || this.historyActiveIndex >= items.length) {
            const activeIndex = items.findIndex((item) => item.classList.contains('is-active'));
            this.historyActiveIndex = activeIndex >= 0 ? activeIndex : 0;
        }

        items.forEach((item, index) => {
            const row = item.closest('.zeclau-history-row');
            const selected = index === this.historyActiveIndex;
            item.classList.toggle('is-active', selected);
            row?.classList.toggle('is-active', selected);
        });

        this.scrollActiveOptionIntoView(this.historyMenu, '.zeclau-history-item.is-active');
    }

    private moveHistorySelection(delta: number): void {
        const items = this.getHistoryMenuItems();
        if (items.length === 0) return;

        if (this.historyActiveIndex < 0 || this.historyActiveIndex >= items.length) {
            this.historyActiveIndex = 0;
        } else {
            this.historyActiveIndex = (this.historyActiveIndex + delta + items.length) % items.length;
        }

        this.ensureHistorySelection();
    }

    private selectHistoryActiveConversation(): void {
        const items = this.getHistoryMenuItems();
        if (items.length === 0) return;

        if (this.historyActiveIndex < 0 || this.historyActiveIndex >= items.length) {
            this.historyActiveIndex = 0;
        }

        const selected = items[this.historyActiveIndex];
        const conversationId = selected?.dataset?.conversationId || '';
        if (!conversationId) return;

        this.switchConversation(conversationId);
        this.hideHistoryMenu();
    }

    private isHistoryCommandInput(text: string): boolean {
        return /\/(history|histroy|hisotry|histry)\b/i.test(text);
    }

    private syncHistoryMenuHeightFromVisibleRow(): void {
        if (!this.historyMenu || this.historyMenu.style.display === 'none') return;

        this.ensureHistorySelection();
        

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

        this.historyActiveIndex = -1;

        for (const [index, conv] of conversations.entries()) {
            const row = this.doc.createElement('div');
            row.className = 'zeclau-history-row';

            const item = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
            item.type = 'button';
            item.style.display = 'block';
            item.style.width = '100%';
            item.style.margin = '0';
            item.className = 'zeclau-history-item zeclau-mention-item';
            item.dataset.conversationId = conv.id;
            if (conv.id === activeId) {
                item.classList.add('is-active');
                row.classList.add('is-active');
                this.historyActiveIndex = index;
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

        this.ensureHistorySelection();

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
                // Group consecutive tool calls into one bubble
                let group = this.messagesContainer.lastElementChild;
                if (!group || !group.classList.contains('zeclau-tool-group')) {
                    group = this.doc.createElement('div');
                    group.className = 'zeclau-tool-group';

                    const header = this.doc.createElement('div');
                    header.className = 'zeclau-tool-group-header';
                    const label = this.doc.createElement('span');
                    label.className = 'zeclau-tool-group-label';
                    label.textContent = '工具调用';
                    const toggle = this.doc.createElement('button');
                    toggle.className = 'zeclau-tool-group-toggle';
                    toggle.type = 'button';
                    toggle.textContent = '收起';
                    header.appendChild(label);
                    header.appendChild(toggle);
                    group.appendChild(header);

                    const body = this.doc.createElement('div');
                    body.className = 'zeclau-tool-group-body';
                    group.appendChild(body);

                    toggle.addEventListener('click', () => {
                        const collapsed = body.style.display === 'none';
                        body.style.display = collapsed ? '' : 'none';
                        toggle.textContent = collapsed ? '收起' : '展开';
                    });

                    this.messagesContainer.appendChild(group);
                }
                const body = group.querySelector('.zeclau-tool-group-body');
                (body || group).appendChild(el);
                // Update count in label
                const label = group.querySelector('.zeclau-tool-group-label');
                const count = (body || group).querySelectorAll('.zeclau-tool-use').length;
                if (label && count > 0) {
                    label.textContent = `工具调用 (${count})`;
                }
                this.scrollToBottom();
            }
        });

        this.service.onToolResult((block: ToolResultBlock) => {
            if (this.messagesContainer) {
                // Find matching tool_use element and update it inline
                const toolEl = this.messagesContainer.querySelector(
                    `.zeclau-tool-use[data-tool-id="${block.toolUseId}"]`
                );
                if (toolEl) {
                    const status = toolEl.querySelector('.zeclau-tool-status');
                    if (status) {
                        status.textContent = block.isError ? '错误' : '完成';
                        status.className = `zeclau-tool-status ${block.isError ? 'zeclau-tool-status-error' : 'zeclau-tool-status-completed'}`;
                    }
                    if (block.content) {
                        const content = this.doc.createElement('pre');
                        content.className = 'zeclau-tool-result-text';
                        content.textContent = block.content.length > 1200
                            ? block.content.substring(0, 1200) + '...'
                            : block.content;
                        toolEl.appendChild(content);
                    }
                } else {
                    // Fallback: render standalone
                    const el = renderToolResult(block, this.doc);
                    this.messagesContainer.appendChild(el);
                }
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
            this.setComposerThinkingState();
        });

        this.service.onStreamEnd(() => {
            this.setComposerInputState();
        });
    }

    private async handleSend(): Promise<void> {
        if (!this.inputTextarea) return;

        const text = this.inputTextarea.value.trim();
        if (!text) return;

        // Handle /history command (before busy check)
        if (this.isHistoryCommandInput(text)) {
            this.inputTextarea.value = '';
            this.resizeInputTextarea();
            this.renderConversationOptions();
            this.showHistoryMenu();
            return;
        }

        if (this.service.busy) return;

        this.followNewest = true;
        this.hideMentionDropdown();
        this.hideHistoryMenu();

        this.inputTextarea.value = '';
        this.resizeInputTextarea();

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

        const { prompt: enriched, skillPrompt } = this.buildPromptWithContexts(text);
        await this.service.sendMessage(enriched, convId, skillPrompt || undefined);
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
        this.resizeInputTextarea();
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
        this.resizeInputTextarea();
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
        this.ensureHistoryMenu();

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

    private buildPromptWithContexts(userText: string): { prompt: string; skillPrompt: string } {
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

        // Detect /skill-name and load SKILL.md content
        const skillMatch = cleanText.match(/^\/(\S+)(?:\s+(.*))?$/);
        let skillPrompt = '';
        let userPrompt = cleanText;
        if (skillMatch) {
            const skillName = skillMatch[1];
            const skillArgs = (skillMatch[2] || '').trim();
            const skillContent = this.loadSkillContent(skillName);
            if (skillContent) {
                skillPrompt = skillContent;
                userPrompt = skillArgs || `Execute the /${skillName} skill.`;
            }
        }

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
            return { prompt: userPrompt || userText, skillPrompt };
        }

        return { prompt: `${userPrompt || userText}\n\n---\n${sections.join('\n\n')}\n---`, skillPrompt };
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
                const folderPath = String(folder.path || '').trim();
                if (!folderPath) {
                    this.updateStatus('未选择有效文件夹');
                    return;
                }

                const folderKey = this.normalizePathForCompare(folderPath);
                const hasFolder = this.selectedLocalFolders.some(
                    (path) => this.normalizePathForCompare(path) === folderKey,
                );
                if (!hasFolder) {
                    this.selectedLocalFolders.push(folderPath);
                }

                const files = this.collectReadableFilesFromFolder(folder, MAX_LOCAL_FILES_PER_FOLDER);
                if (files.length === 0) {
                    this.renderSelectedLocalFiles();
                    this.updateStatus(
                        hasFolder
                            ? `文件夹已存在：${folderPath}`
                            : `已添加文件夹：${folderPath}（未读取到可用文本文件）`,
                    );
                    this.showExternalContextMenu();
                    return;
                }

                const incoming: LocalFileEntry[] = [];
                for (const file of files) {
                    try {
                        const path = String(file.path);
                        const name = String(file.leafName || this.extractFileName(path));
                        const size = Number(file.fileSize || 0);
                        const preview = this.readLocalFilePreview(path, 16 * 1024);
                        incoming.push({ path, name, size, preview, folderPath });
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

                this.selectedLocalFiles = Array.from(merged.values());
                this.renderSelectedLocalFiles();
                this.updateStatus(hasFolder ? `已刷新文件夹：${folderPath}` : `已添加文件夹：${folderPath}`);
                this.showExternalContextMenu();
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
        this.renderExternalContextMenu();
    }

    private removeLocalFile(path: string): void {
        this.selectedLocalFiles = this.selectedLocalFiles.filter((file) => file.path !== path);
        const aliveFolders = new Set<string>();
        for (const file of this.selectedLocalFiles) {
            const folderPath = (file.folderPath || this.extractDirectoryPath(file.path)).trim();
            if (!folderPath) continue;
            aliveFolders.add(this.normalizePathForCompare(folderPath));
        }
        this.selectedLocalFolders = this.selectedLocalFolders.filter((pathItem) => aliveFolders.has(this.normalizePathForCompare(pathItem)));
        this.renderSelectedLocalFiles();
    }

    private renderExternalContextMenu(): void {
        if (!this.externalContextMenu) return;

        this.externalContextMenu.innerHTML = '';

        const folders = this.getSelectedLocalFolderPaths();
        this.updateFolderPickerState(folders.length);

        const header = this.doc.createElement('div');
        header.className = 'zeclau-external-context-header';
        header.textContent = '本地文件夹';
        this.externalContextMenu.appendChild(header);
        if (folders.length === 0) {
            const empty = this.doc.createElement('div');
            empty.className = 'zeclau-external-context-empty';
            empty.textContent = '点击文件夹图标添加';
            this.externalContextMenu.appendChild(empty);
            return;
        }

        const list = this.doc.createElement('div');
        list.className = 'zeclau-external-context-list';

        for (const folderPath of folders) {
            const row = this.doc.createElement('div');
            row.className = 'zeclau-external-context-item';

            const label = this.doc.createElement('div');
            label.className = 'zeclau-external-context-path';
            label.textContent = folderPath;
            label.title = folderPath;

            const removeBtn = this.doc.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'zeclau-external-context-remove';
            removeBtn.title = '移除文件夹';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.removeLocalFolder(folderPath);
            });

            row.appendChild(label);
            row.appendChild(removeBtn);
            list.appendChild(row);
        }

        this.externalContextMenu.appendChild(list);
    }

    private updateFolderPickerState(folderCount?: number): void {
        const count = Number.isFinite(folderCount as number)
            ? Number(folderCount)
            : this.getSelectedLocalFolderPaths().length;

        if (this.folderPickerBtn) {
            this.folderPickerBtn.classList.toggle('has-local-folders', count > 0);
        }

        if (this.folderCountBadge) {
            if (count > 1) {
                this.folderCountBadge.textContent = String(Math.min(99, count));
                this.folderCountBadge.style.display = 'inline-flex';
            } else {
                this.folderCountBadge.textContent = '';
                this.folderCountBadge.style.display = 'none';
            }
        }
    }

    private getSelectedLocalFolderPaths(): string[] {
        if (this.selectedLocalFolders.length > 0) {
            return [...this.selectedLocalFolders];
        }

        const ordered: string[] = [];
        const seen = new Set<string>();

        for (const file of this.selectedLocalFiles) {
            const folderPath = (file.folderPath || this.extractDirectoryPath(file.path)).trim();
            if (!folderPath) continue;
            const key = this.normalizePathForCompare(folderPath);
            if (seen.has(key)) continue;
            seen.add(key);
            ordered.push(folderPath);
        }

        return ordered;
    }

    private removeLocalFolder(folderPath: string): void {
        const folderKey = this.normalizePathForCompare(folderPath);
        this.selectedLocalFolders = this.selectedLocalFolders.filter(
            (path) => this.normalizePathForCompare(path) !== folderKey,
        );
        this.selectedLocalFiles = this.selectedLocalFiles.filter((file) => {
            const entryFolder = (file.folderPath || this.extractDirectoryPath(file.path)).trim();
            return this.normalizePathForCompare(entryFolder) !== folderKey;
        });
        this.renderSelectedLocalFiles();
        this.updateStatus(`已移除文件夹：${folderPath}`);
        this.showExternalContextMenu();
    }

    private showExternalContextMenu(): void {
        this.clearExternalContextHideTimer();
        this.renderExternalContextMenu();
        if (this.externalContextMenu) {
            this.externalContextMenu.style.display = 'block';
            this.positionExternalContextMenu();
            this.doc.defaultView?.requestAnimationFrame(() => this.positionExternalContextMenu());
        }
    }

    private hideExternalContextMenu(): void {
        this.clearExternalContextHideTimer();
        if (this.externalContextMenu) {
            this.externalContextMenu.style.display = 'none';
        }
    }

    private scheduleHideExternalContextMenu(): void {
        this.clearExternalContextHideTimer();
        const win = this.doc.defaultView;
        if (!win) return;

        this.externalContextHideTimer = win.setTimeout(() => {
            this.externalContextHideTimer = null;
            this.hideExternalContextMenu();
        }, 140);
    }

    private clearExternalContextHideTimer(): void {
        if (this.externalContextHideTimer === null) return;
        const win = this.doc.defaultView;
        if (win) {
            win.clearTimeout(this.externalContextHideTimer);
        }
        this.externalContextHideTimer = null;
    }

    private positionExternalContextMenu(): void {
        if (!this.externalContextMenu || !this.folderPickerBtn) return;

        const anchorParent = this.externalContextMenu.parentElement;
        if (!anchorParent) return;

        const parentRect = anchorParent.getBoundingClientRect();
        const btnRect = this.folderPickerBtn.getBoundingClientRect();
        const menuWidth = this.externalContextMenu.offsetWidth || 260;
        const margin = 6;

        let left = btnRect.left - parentRect.left - 8;
        const minLeft = margin;
        const maxLeft = Math.max(minLeft, parentRect.width - menuWidth - margin);
        left = Math.min(Math.max(left, minLeft), maxLeft);

        const bottom = Math.max(
            margin,
            Math.round(parentRect.bottom - btnRect.top + 8),
        );

        this.externalContextMenu.style.setProperty('left', `${Math.round(left)}px`, 'important');
        this.externalContextMenu.style.setProperty('right', 'auto', 'important');
        this.externalContextMenu.style.setProperty('bottom', `${bottom}px`, 'important');
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

    private extractDirectoryPath(path: string): string {
        const normalized = String(path || '').trim();
        if (!normalized) return '';
        const slashIdx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
        if (slashIdx <= 0) return '';
        return normalized.slice(0, slashIdx);
    }

    private normalizePathForCompare(path: string): string {
        return String(path || '').replace(/\//g, '\\').toLowerCase().trim();
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

        // Check for / slash command trigger (but not /history)
        const slashMatch = before.match(/(?:^|\s)\/([^\s]*)$/);
        if (slashMatch && !this.isHistoryCommandInput(value)) {
            const query = (slashMatch[1] || '').toLowerCase();
            void this.updateSlashDropdown(query, caret - slashMatch[0].trimStart().length, caret);
            return;
        }

        const match = before.match(/(?:^|\s)@([^\s@\]]*)$/);

        if (!match) {
            this.hideMentionDropdown();
            return;
        }

        this.slashMode = false;
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

    private async updateSlashDropdown(query: string, start: number, end: number): Promise<void> {
        const skills = await this.loadSkillList();
        if (skills.length === 0) {
            this.hideMentionDropdown();
            return;
        }

        const filtered = skills.filter((s) => {
            if (!query) return true;
            return s.name.toLowerCase().includes(query) || s.fullName.toLowerCase().includes(query);
        });

        if (filtered.length === 0) {
            this.hideMentionDropdown();
            return;
        }

        this.slashMode = true;
        this.currentMentionRange = { start, end };
        this.mentionMatches = filtered.map((s) => ({
            key: `skill:${s.fullName}`,
            title: s.fullName,
            content: s.name,
        }));
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
            if (this.slashMode) {
                item.textContent = `/${ctx.title}`;
            } else {
                const isSelected = this.selectedPaperContexts.some((paper) => paper.key === ctx.key) || this.selectedItemContext?.key === ctx.key;
                if (isSelected) {
                    item.classList.add('is-selected');
                }
                item.textContent = `@${ctx.title}`;
            }
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
        this.scrollActiveOptionIntoView(this.mentionDropdown, '.zeclau-mention-item.is-active');
    }

    private scrollActiveOptionIntoView(container: HTMLElement | null, selector: string): void {
        if (!container) return;
        const active = container.querySelector(selector) as HTMLElement | null;
        if (!active) return;
        try {
            active.scrollIntoView({ block: 'nearest' });
        } catch {
            // ignore old environments
        }
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
        if (this.slashMode) {
            if (this.inputTextarea && this.currentMentionRange) {
                const value = this.inputTextarea.value;
                const start = this.currentMentionRange.start;
                const end = this.currentMentionRange.end;
                const insertion = `/${ctx.title} `;
                this.inputTextarea.value = value.slice(0, start) + insertion + value.slice(end);
                const cursor = start + insertion.length;
                this.inputTextarea.setSelectionRange(cursor, cursor);
                this.inputTextarea.focus();
                this.resizeInputTextarea();
            }
            this.hideMentionDropdown();
            return;
        }

        if (this.inputTextarea && this.currentMentionRange) {
            const value = this.inputTextarea.value;
            const start = this.currentMentionRange.start;
            const end = this.currentMentionRange.end;
            this.inputTextarea.value = (value.slice(0, start) + value.slice(end)).replace(/\s{2,}/g, ' ');
            this.inputTextarea.setSelectionRange(start, start);
            this.inputTextarea.focus();
            this.resizeInputTextarea();
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
        this.resizeInputTextarea();
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

    private loadSkillContent(skillName: string): string | null {
        try {
            const env = Components.classes['@mozilla.org/process/environment;1']
                .getService(Components.interfaces.nsIEnvironment);
            const userProfile = env.get('USERPROFILE') || env.get('HOME') || '';
            if (!userProfile) return null;

            const sep = userProfile.includes('\\') ? '\\' : '/';
            const readFile = (path: string): string | null => {
                try {
                    const f = Components.classes['@mozilla.org/file/local;1']
                        .createInstance(Components.interfaces.nsIFile);
                    f.initWithPath(path);
                    if (!f.exists()) return null;
                    const stream = Components.classes['@mozilla.org/network/file-input-stream;1']
                        .createInstance(Components.interfaces.nsIFileInputStream);
                    stream.init(f, 0x01, 0, 0);
                    const sstream = Components.classes['@mozilla.org/scriptableinputstream;1']
                        .createInstance(Components.interfaces.nsIScriptableInputStream);
                    sstream.init(stream);
                    const data = sstream.read(sstream.available());
                    sstream.close();
                    stream.close();
                    return data;
                } catch { return null; }
            };

            // 1. Check ~/.claude/skills/<name>/SKILL.md
            const standalonePath = userProfile + sep + '.claude' + sep + 'skills' + sep + skillName + sep + 'SKILL.md';
            Zotero.debug(`[Zoclau] loadSkillContent: trying ${standalonePath}`);
            const standaloneSkill = readFile(standalonePath);
            if (standaloneSkill) {
                Zotero.debug(`[Zoclau] loadSkillContent: found standalone skill (${standaloneSkill.length} chars)`);
                return standaloneSkill;
            }

            // 2. Check plugin skills: search cached skill list for matching name
            const match = this.skillCache.find((s) => s.name === skillName || s.fullName === skillName);
            if (match) {
                // Resolve from installed_plugins.json
                const installedPath = userProfile + sep + '.claude' + sep + 'plugins' + sep + 'installed_plugins.json';
                const installedJson = readFile(installedPath);
                if (installedJson) {
                    const installed = JSON.parse(installedJson);
                    for (const entries of Object.values(installed?.plugins || {}) as any[][]) {
                        const entry = Array.isArray(entries) ? entries[0] : entries;
                        if (!entry?.installPath) continue;
                        // Try direct path with fullName (e.g. scientific-skills/rdkit)
                        const parts = match.fullName.split(':');
                        const skillDir = parts.length > 1 ? parts.join(sep) : match.name;
                        const content = readFile(entry.installPath.replace(/\//g, sep) + sep + skillDir + sep + 'SKILL.md');
                        if (content) return content;
                    }
                }
            }

            Zotero.debug(`[Zoclau] loadSkillContent: skill '${skillName}' not found`);
            return null;
        } catch {
            return null;
        }
    }

    private hideMentionDropdown(): void {
        if (this.mentionDropdown) {
            this.mentionDropdown.style.display = 'none';
            this.mentionDropdown.innerHTML = '';
        }
        this.mentionMatches = [];
        this.currentMentionRange = null;
        this.mentionActiveIndex = 0;
        this.slashMode = false;
    }

    private async loadSkillList(): Promise<{ name: string; fullName: string }[]> {
        const now = Date.now();
        if (this.skillCache.length > 0 && now - this.skillCacheAt < 300000) {
            return this.skillCache;
        }

        try {
            const env = Components.classes['@mozilla.org/process/environment;1']
                .getService(Components.interfaces.nsIEnvironment);
            const userProfile = env.get('USERPROFILE') || env.get('HOME') || '';
            if (!userProfile) return [];

            const sep = userProfile.includes('\\') ? '\\' : '/';
            const claudeDir = userProfile + sep + '.claude';
            const skills: { name: string; fullName: string }[] = [];
            const seen = new Set<string>();

            const addSkill = (name: string, fullName: string): void => {
                if (!seen.has(fullName)) {
                    seen.add(fullName);
                    skills.push({ name, fullName });
                }
            };

            // 1. Scan ~/.claude/skills/ (standalone skills)
            try {
                const skillsDir = Components.classes['@mozilla.org/file/local;1']
                    .createInstance(Components.interfaces.nsIFile);
                skillsDir.initWithPath(claudeDir + sep + 'skills');
                if (skillsDir.exists() && skillsDir.isDirectory()) {
                    const entries = skillsDir.directoryEntries;
                    while (entries.hasMoreElements()) {
                        const child = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
                        if (!child.isDirectory() || child.leafName.startsWith('.')) continue;
                        addSkill(child.leafName, child.leafName);
                    }
                }
            } catch { /* skip */ }

            // 2. Scan plugin skills from installed_plugins.json
            try {
                const readFile = (f: any): string => {
                    const stream = Components.classes['@mozilla.org/network/file-input-stream;1']
                        .createInstance(Components.interfaces.nsIFileInputStream);
                    stream.init(f, 0x01, 0, 0);
                    const sstream = Components.classes['@mozilla.org/scriptableinputstream;1']
                        .createInstance(Components.interfaces.nsIScriptableInputStream);
                    sstream.init(stream);
                    const data = sstream.read(sstream.available());
                    sstream.close();
                    stream.close();
                    return data;
                };

                const installedFile = Components.classes['@mozilla.org/file/local;1']
                    .createInstance(Components.interfaces.nsIFile);
                installedFile.initWithPath(claudeDir + sep + 'plugins' + sep + 'installed_plugins.json');
                if (installedFile.exists()) {
                    const installed = JSON.parse(readFile(installedFile));
                    const plugins = installed?.plugins || {};

                    for (const [pluginKey, entries] of Object.entries(plugins) as [string, any[]][]) {
                        const entry = Array.isArray(entries) ? entries[0] : entries;
                        if (!entry?.installPath) continue;
                        const pluginId = pluginKey.split('@')[0] || '';

                        const installDir = Components.classes['@mozilla.org/file/local;1']
                            .createInstance(Components.interfaces.nsIFile);
                        installDir.initWithPath(entry.installPath.replace(/\//g, '\\'));
                        if (!installDir.exists() || !installDir.isDirectory()) continue;

                        const scanDir = (dir: any, prefix: string): void => {
                            const dirEntries = dir.directoryEntries;
                            while (dirEntries.hasMoreElements()) {
                                const child = dirEntries.getNext().QueryInterface(Components.interfaces.nsIFile);
                                if (!child.isDirectory() || child.leafName.startsWith('.')) continue;
                                const name = child.leafName;

                                try {
                                    const sf = child.clone();
                                    sf.append('SKILL.md');
                                    if (sf.exists()) {
                                        addSkill(name, prefix ? `${prefix}:${name}` : name);
                                    }
                                } catch { /* skip */ }

                                // Recurse one level
                                try {
                                    const subEntries = child.directoryEntries;
                                    while (subEntries.hasMoreElements()) {
                                        const sub = subEntries.getNext().QueryInterface(Components.interfaces.nsIFile);
                                        if (!sub.isDirectory() || sub.leafName.startsWith('.')) continue;
                                        try {
                                            const sf2 = sub.clone();
                                            sf2.append('SKILL.md');
                                            if (sf2.exists()) {
                                                addSkill(sub.leafName, prefix ? `${prefix}:${sub.leafName}` : `${name}:${sub.leafName}`);
                                            }
                                        } catch { /* skip */ }
                                    }
                                } catch { /* skip */ }
                            }
                        };

                        scanDir(installDir, pluginId);
                    }
                }
            } catch { /* skip */ }

            this.skillCache = skills;
            this.skillCacheAt = now;
            return skills;
        } catch {
            return [];
        }
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

    private setComposerThinkingState(): void {
        this.setInputEnabled(false);
        this.updateStatus('思考中...');
        this.setLiveState('thinking');
        if (this.stopButton) {
            this.stopButton.style.display = 'inline-block';
        }
    }

    private setComposerInputState(): void {
        this.setInputEnabled(true);
        this.updateStatus('就绪');
        this.setLiveState('ready');
        if (this.stopButton) {
            this.stopButton.style.display = 'none';
        }

        const win = this.doc.defaultView;
        if (win?.requestAnimationFrame) {
            win.requestAnimationFrame(() => this.focusInputTextareaWithRetry());
            return;
        }
        this.focusInputTextareaWithRetry();
    }

    private focusInputTextareaWithRetry(attempt = 0): void {
        if (!this.inputTextarea || this.inputTextarea.disabled || !this.inputTextarea.isConnected) {
            return;
        }

        try {
            this.inputTextarea.focus();
            const caret = this.inputTextarea.value.length;
            this.inputTextarea.setSelectionRange(caret, caret);
        } catch {
            // ignore focus failures and retry below
        }

        if (this.doc.activeElement === this.inputTextarea) {
            return;
        }

        if (attempt >= 3) {
            return;
        }

        const delay = attempt === 0 ? 0 : 40;
        this.doc.defaultView?.setTimeout(() => this.focusInputTextareaWithRetry(attempt + 1), delay);
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
        if (this.inputAreaResizeObserver) {
            this.inputAreaResizeObserver.disconnect();
            this.inputAreaResizeObserver = null;
        }
        this.clearExternalContextHideTimer();

        this.container.innerHTML = '';
        this.messagesWrapper = null;
        this.messagesContainer = null;
        this.inputArea = null;
        this.inputTextarea = null;
        this.sendButton = null;
        this.stopButton = null;
        this.modelSelector = null;
        this.statusBar = null;
        this.statusDot = null;
        this.composerToolbar = null;
        this.conversationTitleBtn = null;
        this.historyToggleBtn = null;
        this.historyMenu = null;
        this.currentItemChip = null;
        this.selectedContextWrap = null;
        this.localFilesWrap = null;
        this.folderPickerBtn = null;
        this.folderCountBadge = null;
        this.externalContextMenu = null;
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
        this.selectedLocalFolders = [];
        this.inputAreaBaseHeight = 0;
    }
}









































































