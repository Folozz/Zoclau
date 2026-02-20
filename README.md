# Zoclau

[中文文档](README.zh-CN.md)

Zoclau is a Zotero 7 plugin that embeds Claude Code into the Zotero sidebar, so you can chat, analyze, and work with local context during literature research.

![Zoclau Screenshot](imgs/1.png)

## Features

- Embedded chat panel in Zotero item pane
- Streaming responses
- Conversation history management
- Local folder context picker (multi-folder, count badge, list management)
- Item/folder context referencing
- Configurable permission mode:
  - `yolo` (no prompt)
  - `normal` (safer, confirmation-oriented)
  - `plan` (exploration first)
- Command blocklist for Windows and Unix/Git Bash
- Auto-scroll toggle for streaming output
- Optional loading of `~/.claude/settings.json`

## Requirements

- Zotero 7
- Claude Code CLI installed and available
- Windows users: Git Bash recommended (or set `CLAUDE_CODE_GIT_BASH_PATH`)

## Usage

- **Basic Chat**: Interact directly with Claude Code in the chat panel.
- **History Command**: Type `history` to view and manage your past conversation history.
- **Mentions**: Use `@` to reference specific Zotero items or papers to provide local context.
- **Skills & Tools**: Leverage Claude Code's capabilities to explore your local data and run tools.

![History](imgs/history.png)

![Cite Papers](imgs/引用论文.png)

![Skills](imgs/skills.png)

## Install

### Option A: Install from Release (recommended)

1. Download `zoclau.xpi` from the latest GitHub Release.
2. In Zotero: `Tools` -> `Plugins`.
3. Click the gear icon -> `Install Plugin From File...`.
4. Select `zoclau.xpi`.
5. Restart Zotero if prompted.

### Option B: Build from source

```bash
npm install
npm run build
node pack-xpi.cjs
```

Generated artifacts:

- `build/addon/` (unpacked addon)
- `zoclau.xpi` (installable package)

## Configuration

Open Zotero settings and locate **Zoclau**. Current options include:

- Claude CLI path
- Working directory
- Permission mode
- Auto-scroll during streaming
- Load user Claude settings
- Blocked commands (Windows / Unix-Git Bash)

All settings are auto-saved.

## Security Notes

Zoclau uses Claude Code tooling capabilities. Depending on permission mode, model output may run tool actions (including shell/file operations).  
Review and keep blocklists strict for your environment.

## Development

```bash
npm run dev       # watch mode
npm run build     # production build
npm run typecheck # TypeScript check
```

Key files:

- `src/index.ts` - plugin entry and lifecycle integration
- `src/service/ClaudeService.ts` - Claude CLI process/stream handling
- `src/ui/ChatPanel.ts` - chat UI and interactions
- `content/preferences.xhtml` - Zotero settings UI
- `content/preferences.js` - settings behavior and auto-save logic
- `esbuild.config.mjs` - bundle/copy pipeline

## License

MIT
