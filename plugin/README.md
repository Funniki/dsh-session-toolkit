# ⚡ DeepSeek Harness - 会话功能增强套件 (Session Toolkit)

<p align="center">
  <img src="icon.svg" width="96" height="96" alt="dsh-session-toolkit logo" />
</p>

<p align="center">
  <strong>专为 DeepSeek Harness 设计的多合一会话管理与输入增强插件包</strong>
</p>

<p align="center">
  <a href="https://github.com/Funniki/dsh-session-toolkit"><img src="https://img.shields.io/badge/version-2.3.10-blue.svg?style=flat-square" alt="Version" /></a>
  <a href="https://github.com/deepseek-ai"><img src="https://img.shields.io/badge/DSH-compatible%20%3E%3D0.2.0-brightgreen.svg?style=flat-square" alt="DSH Compatibility" /></a>
  <a href="https://github.com/Funniki/dsh-session-toolkit"><img src="https://img.shields.io/github/stars/Funniki/dsh-session-toolkit?style=social" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License" /></a>
</p>

---

## 📖 简介

**dsh-session-toolkit** 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai) 的复合型功能增强套件（Bundle Pack）。

采用符合官方标准的 Cordis Bundle 架构：
- 🎯 **干净整洁**：在 DSH 插件列表里**仅占用一个「会话功能增强」条目**，杜绝插件列表臃肿。
- 🧩 **独立管理**：点开详情后，内置的 **5 大功能组件** 各自保留原版图标、名称与独立开关，随心启用。
- 📦 **零额外依赖**：自带完整运行时依赖，无需配置复杂环境，开箱即用。

---

## ✨ 核心功能与入口一览

| 模块组件 | 组件包名 | 核心功能 | 使用入口 |
| :--- | :--- | :--- | :--- |
| **🗑️ 删除已归档会话** | `dsh-archived-session-delete` | 彻底清理过期的归档会话，抹除日志与投影缓存 | 已归档会话悬停出现的红色删除按钮；或会话菜单「...」中的「删除已归档会话」 |
| **🚚 会话移动到工作区** | `dsh-session-move` | 将当前会话平跨移动到另一个工作区。**支持热迁移**：会话进行中空闲时可直接搬迁，搬完在新工作区继续对话 | 会话菜单「...」中的「移动到工作区…」 |
| **🛡️ 未发送内容备份** | `dsh-unsent-content-guard` | 自动保存输入框未发送的文本草稿与图片。切换会话或异常崩溃后一键恢复 | 输入框下方的「未发送备份」浮动胶囊 |
| **📋 长文本转附件** | `dsh-auto-paste` | 粘贴大段文本（代码/日志/文档）时自动转存为 `pastes/*.md` 附件卡片，防止撑爆上下文和输入框 | 在输入框粘贴超长文本（500+ 字）时自动触发 |
| **🔍 会话历史全文搜索** | `dsh-session-history-search` | 支持中文关键词模糊检索跨会话的历史发言，一键回溯定位 | 全局快捷键 `Ctrl+Shift+K` 或输入框下方的「搜索历史」小按钮 |

---

## 安装 / 更新

### 在 DeepSeek Harness 网页版或桌面版中安装

在 **Add plugin** 向导的搜索框中填写 GitHub 仓库地址：

```
https://github.com/Funniki/dsh-session-toolkit
```

然后点击 **Install**。

### 使用 `dsh` CLI 安装

从 [DeepSeek Harness](https://github.com/deepseek-ai) 安装 `dsh-session-toolkit` 插件：

```sh
dsh plugin --profile desktop add https://github.com/Funniki/dsh-session-toolkit
```

或更新 `dsh-session-toolkit` 插件：

```sh
dsh plugin --profile desktop update dsh-session-toolkit@latest
```

然后刷新 DSH 页面或启动 Web UI。无需构建，也无需重启。

### 本地源码安装（开发调试）

如果你已克隆源码到本地，可直接通过本地源码目录挂载安装：

```sh
dsh plugin --profile desktop add ./plugin
```

---

## 🛠️ 项目结构与本地构建

```
session-toolkit/
├── plugin/                      # 插件核心源码包
│   ├── components/              # 5 个内置独立组件的源码
│   ├── cordis.patch.yml         # 核心 patch 编排描述文件
│   ├── lib/index.js             # 入口模块
│   ├── locale/{zh,en}.json      # 中英文国际化多语言
│   └── icon.svg                 # 套件主图标
├── tools/
│   └── build-dist.cjs           # 一键打包与产物生成脚本
├── verification/                # 自动化测试与迁移验证工具
└── README.md                    # 项目说明文档
```

### 构建分发包

在本项目根目录下运行打包脚本，会自动同步依赖并生成开箱即用的分发 zip 包：

```bash
node tools/build-dist.cjs
```
打包成功后，可在 `dist/` 目录下找到新生成的自包含压缩包。

---

## 📌 注意事项与已知边界

1. **不可逆删除**：删除归档会话属于永久抹除操作，无法找回，请谨慎操作。
2. **热迁移时机**：会话热迁移建议在 Agent 处于非运行（空闲）状态下操作。若有正在执行的任务，建议等待执行完毕或排队等待重启后自动完成迁移。
3. **版本兼容**：本套件组件均适配 DSH 当前的会话格式（v4 协议）。

---

## 🤝 贡献与致谢

欢迎提交 Issue 反馈问题或提出新功能建议！如果你也编写了实用的 DSH 组件，欢迎提交 Pull Request 将其整合到此套件中。

- 遵循 **MIT License** 开源。
