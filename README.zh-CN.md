# 🚀 Zoclau

[English](README.md) • [中文文档](README.zh-CN.md)

Zoclau 是一个 Zotero 7 插件，将 Claude Code 嵌入到 Zotero 侧栏，方便你在文献管理场景中直接进行对话、分析和本地上下文协作。

<div align="center">
  <img src="imgs/1.png" alt="Zoclau Screenshot" width="800" />
</div>

---

## ✨ 功能特性

- 💬 **Zotero 内嵌聊天**：在条目面板直接进行对话，支持流式输出回复。
- 📜 **历史会话管理**：轻松查看、切换和管理之前的对话。
- 📂 **本地上下文选择**：支持多文件夹选择、角标计数和列表管理。
- 🔗 **上下文快捷引用**：通过 `@` 快速引用文献条目或文件夹作为上下文。
- 🛡️ **灵活的权限模式**：
  - `yolo`（无提示直接执行）
  - `normal`（安全优先，需确认）
  - `plan`（先探索分析，再执行操作）
- 🚫 **命令黑名单**：支持为 Windows 与 Unix/Git Bash 分别配置阻止的命令。
- ⚙️ **丰富设置**：支持开启流式自动滚动、可选加载系统 `~/.claude/settings.json`。

---

## 💻 环境要求

- **Zotero 7**
- 已全局安装 **Claude Code CLI**，且可通过终端调用
- **Windows 用户**：强烈建议安装 **Git Bash**（如果未在系统 Path 中，可在插件设置里配置 `CLAUDE_CODE_GIT_BASH_PATH`）

---

## 📖 使用说明

- **基础对话**：在 Zotero 右侧边栏的聊天框中直接与 Claude 交流，处理当前文献。
- **历史记录**：在输入框键入 `history`，即可查看并切换历史会话。
- **上下文引用**：键入 `@` 呼出菜单，快速引用 Zotero 中的特定条目或相关文献，为对话提供极强的背景关联。
- **技能工具**：结合 Claude Code 强大的工具链，进行本地阅读、分析总结等高级操作。

### 界面展示

| 📜 历史记录 | 📎 引用文献 / 条目 | 🛠️ 技能与工具 |
| :---: | :---: | :---: |
| <img src="imgs/history.png" width="260" alt="History" /> | <img src="imgs/引用论文.png" width="260" alt="Cite Papers" /> | <img src="imgs/skills.png" width="260" alt="Skills" /> |

---

## 📦 安装方式

### 方式 A：从 Release 安装（⭐ 推荐）

1. 前往 GitHub 的 [Releases 页面](https://github.com/Folozz/Zoclau/releases) 下载最新版的 `zoclau.xpi`。
2. 打开 Zotero，点击菜单栏：`工具` -> `插件`。
3. 点击右上角齿轮图标 ⚙️ -> 选择 `Install Plugin From File...`。
4. 选择下载好的 `zoclau.xpi` 并确认。
5. 按提示重启 Zotero。

### 方式 B：从源码构建

```bash
# 1. 安装依赖
npm install

# 2. 构建项目
npm run build

# 3. 打包为 xpi 文件
node pack-xpi.cjs
```

**构建产物**：
- `build/addon/`：未打包的插件目录
- `zoclau.xpi`：可直接安装的 Zotero 插件包

---

## ⚙️ 设置说明

打开 Zotero 设置，在左侧找到 **Zoclau** 选项卡。当前支持自定义以下选项：

- **Claude CLI 路径**（如果未在环境变量中）
- **工作目录**
- **权限模式**
- **流式输出时自动滚动**
- **加载用户 Claude 设置**
- **阻止命令**（Windows / Unix-Git Bash 分开配置）

*(提示：所有设置均会在修改后自动保存)*

---

## ⚠️ 安全说明

Zoclau 利用了 Claude Code 强大的本地工具能力。根据您配置的权限模式，模型可能会在您的电脑上执行命令行或文件操作。
**请务必根据您的使用环境，严格审查并维护工具命令黑名单。**

---

## 🛠️ 开发说明

```bash
npm run dev       # 监听文件变化并增量构建 (watch 模式)
npm run build     # 生产环境完整构建
npm run typecheck # TypeScript 类型检查
```

**核心文件结构**：
- `src/index.ts`：插件入口与 Zotero 生命周期整合
- `src/service/ClaudeService.ts`：处理 Claude CLI 进程与流式输出
- `src/ui/ChatPanel.ts`：聊天 UI 渲染与交互逻辑
- `content/preferences.xhtml` & `content/preferences.js`：Zotero 设置界面及自动保存逻辑
- `esbuild.config.mjs`：打包配置与静态资源处理

---

## 📄 许可证

[MIT License](LICENSE)
