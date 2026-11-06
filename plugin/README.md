# 会话功能增强（dsh-session-toolkit）— 单插件 · 五组件

**一个插件包（pack），里面五个组件**，结构与官方 `@deepseek-ai/dsh-experimental-session-search` 一致：插件列表里只出现一个条目「会话功能增强」，点开后「包含的组件」列出五个独立条目，每个组件保留自己原来的名称、描述和图标，并且可以单独开关。

| 组件（row id） | 组件包（name） | 显示名称 / 图标 |
|---|---|---|
| `archived-session-delete` | `dsh-archived-session-delete` | 删除已归档会话（原图标） |
| `session-move` | `dsh-session-move` | 会话移动到工作区（原图标；v1.1.0 起支持热迁移：会话开着也能搬，搬完继续在新目录） |
| `unsent-content-guard` | `dsh-unsent-content-guard` | 未发送内容备份（原图标） |
| `auto-paste` | `dsh-auto-paste` | 长文本转附件（粘贴长文存 pastes/*.md|*.txt，卡片带开头预览） |
| `session-history-search` | `dsh-session-history-search` | 会话历史搜索（中文关键词搜历史消息，小窗；原图标） |

## 结构

```
session-toolkit/plugin/          # pack 包：dsh-session-toolkit@0.1.0
├── package.json                 # main 为空模块；dsh.bundle.patch 指向下面
├── cordis.patch.yml             # 5 条 insert：每条 name 指向一个组件包
├── lib/index.js                 # 空模块（pack 自身没有 plugin row）
├── locale/{zh,en}.json          # pack 的显示名/描述（会话功能增强）
└── icon.svg                     # pack 的图标（星芒）
```

组件包本身**逐字节沿用原插件**（`archived-session-delete/plugin`、`session-workspace-move/plugin`、`unsent-content-guard/plugin`），它们作为 pack 的**依赖**安装进 profile（`node_modules`），但**不进入** `dsh.profile.bundles`——所以不会在插件列表里各占一个条目。

- Host：每条 row 加载对应组件包的 host 半边；
- 浏览器：`client-modules` 按 Loader entry 扫描，每个组件包自己的 `dsh.client` 被加载（所以三个功能的界面代码都是原来的）；
- 显示元数据：组件条目的 title/description/icon 由 `pluginPackages.metaOf(row.name, base)` 从**组件包自己**的 `locale/*.json` + `icon` 读取（与官方 session-search 的做法相同）；
- 配置：每条 row 的 `config` 归各自组件（等价于原来三个插件各自的配置）。

## 加组件 / 减组件

加一个组件只要两步：

1. 把新组件包加进 profile 依赖（推荐和本包一样用 `link:` 本地包或 npm 包）；
2. 在 `cordis.patch.yml` 的 `- insert:` 列表里追加一条：

```yaml
    - id: <组件 row id>
      name: '<组件包名>'
      config: {}
```

然后重新安装/刷新本 pack（或重启 DSH），「包含的组件」就会多一项；组件包自己的 `locale/*.json` + `icon.svg` 决定它的显示名称、描述和图标。

移除组件：删除该行 + 从 profile 依赖中移除该包。

## 当前安装状态（v2.0.0）

- ✅ `dsh-session-toolkit@0.1.0` 已安装（`application: applied`）
- profile `dsh.profile.bundles` 中本套件只有 `dsh-session-toolkit` 一项
- profile `dependencies` 含三个组件包（`link:` 指向各自源码目录）——这是 pack 的组件依赖，不是独立插件
- 插件列表应显示：**会话功能增强**（1 个条目）→ 包含的组件：**3 个**（删除已归档会话 / 会话移动到工作区 / 未发送内容备份，各自原图标）

## 验证

- Loader 行：`archived-session-delete`、`session-workspace-move`、`unsent-content-guard` 三条 entry 均存在（`Config.listConfigs` 可查）；
- 会话菜单 slot：`move-to-workspace`(410)、`delete-archived-session`(440) active；行悬停删除、输入框备份胶囊 active；
- 组件浏览器半已加载：迁移 probe `render`、未发送备份 probe `activate` + `capture-text` 持续写入；
- 数据目录不变：`~/.dsh/unsent-content/`、`~/.dsh/session-workspace-move/` 原样保留；
- 显示元数据：pack 自身「会话功能增强」+ 组件各自原名称/图标（`verify-display-meta.cjs` 检查 pack 元数据；组件元数据由各自包的 locale/icon 决定，与原来一致）。

详见 [`verification/README.md`](../verification/README.md)。

## 已知边界（继承原插件）

- 打开过的会话不能即时移动：排队，重启 DSH 后完成；
- 删除归档会话不可恢复（删日志、投影缓存、工作区记账、归档标记）；
- 未发送备份在发送成功后清理、切换/重启后恢复；
- 三者都只支持当前 DSH 会话格式 v4。

## 分发给其他人

打包（会自动把 `components/` 同步到 `node_modules/`，再生成 zip）：

```powershell
node tools/build-dist.cjs
```

产物：[dist/dsh-session-toolkit-2.0.0.zip](dist/dsh-session-toolkit-2.0.0.zip)（约 55 KB，自包含：三个组件已放在包内 `node_modules/`，收件人不需要任何额外依赖或 profile 改动）。

收件人安装步骤见压缩包里的 `安装说明.md`：解压到固定目录 → DSH 插件页「添加插件 → 本地目录」选中解压出的文件夹 → 刷新。注意目录不能移动/删除（DSH 以链接方式安装本地目录）。
