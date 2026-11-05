# 变更日志

版本号约定（本项目）：

- **0.1.0** 是首个对外版本。
- **修 bug / 零散小问题**：不逐个涨号，攒成一批合并后再涨一次 `0.1.x`。
- **增加功能**：涨 `0.1.x`；一批功能较多时可以跨几个号（例如 `0.1.0` → `0.1.4`）。
- **新增组件**（结构性变化）：涨 `0.x.0`，例如 `0.2.0`。
- 实验性改动本身**不改版本号**，只在准备发版时统一调整。

---

## 0.1.0

首个对外版本：会话管理五件套，可作为 npm 包安装（`@funniki/dsh-session-toolkit`）。

包含 5 个组件：

| 组件 | 作用 |
|---|---|
| `dsh-archived-session-delete` | 删除已归档会话 |
| `dsh-session-move` | 把会话移动到另一个工作区（带备份、校验、失败回滚） |
| `dsh-unsent-content-guard` | 保护未发送的输入内容与图片 |
| `dsh-session-history-search` | 关键词搜索历史会话（支持中文） |
| `dsh-auto-paste` | 长文本自动落盘为文件后再粘贴 |

工程侧变化：

- 改为标准 npm 包形态：清单在包根，`dsh.bundle.patch` 指向包内补丁。
- 5 个组件行使用**包子路径**（`@funniki/dsh-session-toolkit/components/<组件>`），
  组件随包安装、从包内解析，**不再需要 profile 里的手工 junction**。
- 每个组件的 `locale/*.json` 与 `icon` 通过 `exports` 暴露，插件页能显示各自的
  标题、描述与图标（纯 `file:` 行会被 DSH 的 `readPluginMeta` 跳过，导致名称/图标丢失）。
- 依赖改为声明式（`@deepseek-ai/dsh-tools`、`dsh-typert-protocol`、`schemastery`），
  不再 vendor 依赖树：tarball 从 2.98 MB 降到约 168 KB，且不含 `node_modules`。
- 构建统一为 `pnpm pack`（`node tools/build-dist.cjs`，加 `--publish` 可发布）。
