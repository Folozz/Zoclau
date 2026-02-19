# Zoclau

[English](README.md)

Zoclau 是一个 Zotero 7 插件，将 Claude Code 嵌入到 Zotero 侧栏，方便你在文献管理场景中直接进行对话、分析和本地上下文协作。

## 功能特性

- Zotero 条目面板内嵌聊天界面
- 流式输出回复
- 历史会话管理
- 本地文件夹上下文选择（支持多文件夹、角标计数、列表管理）
- 条目/文件夹上下文引用
- 可配置权限模式：
  - `yolo`（不提示）
  - `normal`（更安全，偏确认）
  - `plan`（先探索再执行）
- Windows 与 Unix/Git Bash 分别可配的命令黑名单
- 流式输出自动滚动开关
- 可选加载 `~/.claude/settings.json`

## 环境要求

- Zotero 7
- 已安装 Claude Code CLI，且可被系统调用
- Windows 建议安装 Git Bash（或设置 `CLAUDE_CODE_GIT_BASH_PATH`）

## 安装方式

### 方式 A：从 Release 安装（推荐）

1. 从 GitHub 最新 Release 下载 `zoclau.xpi`。
2. Zotero 中打开 `工具` -> `插件`。
3. 点击右上角齿轮 -> `Install Plugin From File...`。
4. 选择 `zoclau.xpi`。
5. 按提示重启 Zotero。

### 方式 B：从源码构建

```bash
npm install
npm run build
node pack-xpi.cjs
```

构建产物：

- `build/addon/`（未打包插件目录）
- `zoclau.xpi`（可安装包）

## 设置说明

打开 Zotero 设置中的 **Zoclau**，当前支持：

- Claude CLI 路径
- 工作目录
- 权限模式
- 流式输出时自动滚动
- 加载用户 Claude 设置
- 阻止命令（Windows / Unix-Git Bash）

所有设置均自动保存。

## 安全说明

Zoclau 使用 Claude Code 的工具能力。根据权限模式不同，模型可能执行工具动作（包括命令行/文件操作）。  
请根据你的环境严格维护命令黑名单。

## 开发命令

```bash
npm run dev       # 监听构建
npm run build     # 生产构建
npm run typecheck # TypeScript 类型检查
```

核心文件：

- `src/index.ts`：插件入口与生命周期整合
- `src/service/ClaudeService.ts`：Claude CLI 进程与流式处理
- `src/ui/ChatPanel.ts`：聊天 UI 与交互
- `content/preferences.xhtml`：Zotero 设置界面
- `content/preferences.js`：设置逻辑与自动保存
- `esbuild.config.mjs`：打包与静态资源拷贝

## 许可证

MIT
