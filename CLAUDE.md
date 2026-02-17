# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zoclau is a Zotero 7 plugin that embeds Claude Code as a research assistant in the Zotero sidebar. It allows users to chat with Claude about their research papers, with full agentic capabilities (file operations, bash commands, etc.).

**Key Technologies:**
- Zotero 7 plugin architecture (Firefox/XUL-based)
- TypeScript compiled to IIFE bundle via esbuild
- Claude CLI integration via Mozilla's Subprocess API (not Node.js child_process)
- No React/Vue - vanilla DOM manipulation

## Build Commands

```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Type checking only (no emit)
npm run typecheck
```

The build outputs to `build/addon/` which contains the complete plugin structure ready for Zotero installation.

## Architecture

### Plugin Lifecycle (bootstrap.js)

Zotero 7 uses a bootstrap pattern with these lifecycle hooks:
1. `startup()` - Registers chrome URIs, loads main script, calls `init()`
2. `onMainWindowLoad()` - Mounts UI when Zotero's main window loads
3. `onMainWindowUnload()` - Cleans up window-specific resources
4. `shutdown()` - Full cleanup on plugin disable/uninstall

The bootstrap loads `content/zeclau.js` (compiled from `src/index.ts`) which exports the plugin's main API.

### Core Components

**src/index.ts** - Plugin entry point
- Registers item pane section (right sidebar in Zotero)
- Manages stylesheet registration
- Handles preference pane registration
- Coordinates between services and UI

**src/service/ClaudeService.ts** - Claude CLI integration
- Spawns Claude CLI process using Mozilla's `Subprocess.sys.mjs` (NOT Node.js APIs)
- Handles streaming JSON output from CLI (`--output-format stream-json`)
- Manages conversation sessions via `--resume` flag
- Parses stream events: `content_block_delta`, `tool_use`, `tool_result`, etc.
- Auto-detects Git Bash on Windows (required for Claude CLI on Windows)

**src/ui/ChatPanel.ts** - Main chat interface
- Renders chat UI in Zotero's item pane
- Handles @ mentions for paper context (searches current Zotero folder)
- Manages local file attachments (folder picker)
- Conversation history with keyboard navigation
- Auto-scroll behavior with manual scroll detection

**src/ui/ConversationManager.ts** - Conversation persistence
- Stores conversations in Zotero preferences
- Auto-prunes old conversations (30-90 day retention based on storage size)
- Limits to 15 conversations max
- Persists messages separately from metadata

**src/ui/MessageRenderer.ts** - Message rendering
- Converts markdown to HTML (basic implementation)
- Renders tool use/result blocks
- Handles streaming message updates

### Key Patterns

**Mozilla/Zotero APIs (not Node.js):**
- File I/O: `Components.classes['@mozilla.org/file/local;1']`
- Process spawning: `ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs')`
- Environment variables: `Components.classes['@mozilla.org/process/environment;1']`
- Preferences: `Zotero.Prefs.get/set`

**Claude CLI Integration:**
- Always use `--output-format stream-json` with `--verbose`
- Parse line-by-line JSON events (not SSE format)
- Session continuity via `--resume <session-id>` extracted from stream events
- Permission modes: `yolo` (bypass), `normal` (acceptEdits), `plan` (plan mode)

**Zotero Item Context:**
- Extract paper metadata via `item.getField('title')`, `item.getCreators()`, etc.
- Build context strings with title, authors, year, abstract, tags
- Support @ mentions to reference papers from current folder

## Development Notes

**When modifying ClaudeService:**
- Never use Node.js APIs (`child_process`, `fs`, `path`, `os`)
- Use Mozilla's Subprocess API for process spawning
- Handle both Windows and Unix-like systems
- Git Bash detection is critical for Windows support

**When modifying ChatPanel:**
- All DOM manipulation is vanilla JavaScript (no framework)
- Use `this.doc.createElement` for cross-document compatibility
- Zotero's item pane sections have specific lifecycle hooks (`onInit`, `onRender`, `onItemChange`, `onDestroy`)

**When adding preferences:**
1. Add to `prefs.js` with default value
2. Add to `ZeClauSettings` interface in `src/settings/types.ts`
3. Add to `SETTINGS_KEYS` array in `src/index.ts`
4. Update `content/preferences.xhtml` UI

**Build System:**
- esbuild bundles to IIFE format (target: firefox115)
- Global name: `_ZeClauModule` registered as `Zotero.ZeClau`
- Static files copied post-build (manifest, bootstrap, prefs, CSS, icons)
- Source maps inline in dev mode, disabled in production

## Testing

No automated test suite currently. Manual testing workflow:
1. Build with `npm run dev` (watch mode)
2. Install in Zotero: Tools → Plugins → Install Plugin from File → select `build/addon/manifest.json`
3. Restart Zotero after code changes
4. Check Zotero's Error Console (Tools → Developer → Error Console) for logs

## Common Issues

**Claude CLI not found:**
- Auto-detection runs on first init (checks PATH, common install locations)
- Manual path can be set in preferences
- Windows requires Git Bash - auto-detected or set via `CLAUDE_CODE_GIT_BASH_PATH` env var

**Streaming output issues:**
- Ensure CLI version supports `--output-format stream-json --verbose`
- Parse events by type: `content_block_delta`, `tool_use`, `tool_result`, `assistant`, `user`
- Handle both structured events and fallback text extraction

**Zotero API compatibility:**
- Plugin targets Zotero 7 (Firefox 115 ESR base)
- Use `Zotero.getMainWindow()` to access main window from dialogs
- Item pane sections are Zotero 7+ only (not available in Zotero 6)
