# 会话功能增强（单插件 · 五组件）

一个插件包（bundle / pack），里面五个组件——结构与官方 `@deepseek-ai/dsh-experimental-session-search` 一致。插件列表里只显示 **「会话功能增强」** 一个条目，点开后「包含的组件」列出三个独立组件，每个组件保留原来的名称、描述、图标，并可单独开关。

| 组件 | 组件包 | 功能入口 |
|---|---|---|
| 删除已归档会话 | `dsh-archived-session-delete` v1.1.2 | 已归档会话行悬停红色删除按钮；会话「...」菜单「删除已归档会话」(440) |
| 会话移动到工作区 | `dsh-session-move` v1.1.0 | 会话「...」菜单「移动到工作区…」(410)；**热迁移**：打开中的会话空闲时可直接搬，搬完继续用新目录 |
| 未发送内容备份 | `dsh-unsent-content-guard` v1.0.7 | 输入框下方「未发送备份」胶囊（dock order 2） |
| 长文本转附件 | `dsh-auto-paste` v1.0.0（改造版） | 粘贴长文自动存 `pastes/`（Markdown 存 .md，否则 .txt），输入框卡片带开头预览 |
| 会话历史搜索 | `dsh-session-history-search` v1.1.0 | 输入框下方「搜索历史」小按钮（dock order 3）或 Ctrl+Shift+K 弹出小窗；中文关键词搜历史消息 |

## 结构（可直接往里加组件）

```
session-toolkit/
├── plugin/                      # pack 包 dsh-session-toolkit@2.0.0
│   ├── package.json             # dsh.bundle.patch；main 为空模块
│   ├── cordis.patch.yml         # 5 条 insert，每条 name 指向一个组件包
│   ├── lib/index.js
│   ├── locale/{zh,en}.json      # pack 显示名：会话功能增强
│   └── icon.svg                 # pack 图标：星芒
├── verification/                # 验证证据
└── tools/generate-toolkit.cjs   # 旧合并方案的生成器（历史保留）
```

组件包以**拷贝**形式放在 `plugin/components/<组件包名>/`（保留 main / `dsh.client` / `locale` / `icon`，但**去掉 `dsh.bundle`**），作为 pack 的 **profile 依赖**安装（`link:`），但**不进** `dsh.profile.bundles`——所以不会各占一个插件条目。组件显示元数据（名称/描述/图标）由 `pluginPackages.metaOf(row.name, base)` 从组件包自己的 `locale/*.json` + `icon` 读取，因此显示的就是原来的图标和名称。

**加组件**：把组件包加入 profile 依赖，然后在 `plugin/cordis.patch.yml` 的 `- insert:` 列表追加

```yaml
    - id: <组件 row id>
      name: '<组件包名>'
      config: {}
```

**减组件**：删除该行并移除对应依赖。

## 当前状态（v2.0.0 已安装）

- `dsh-session-toolkit@2.0.0`：`application: applied`
- profile bundles：本套件仅 `dsh-session-toolkit`
- profile dependencies：三个组件包（`link:` 指向源码目录）
- Loader 行：`archived-session-delete`、`session-move`、`unsent-content-guard` 等 entry 均在
- 三组件界面均 active（菜单 410/440、行悬停删除、输入框备份胶囊）
- 客户端 probe：迁移 `render`；未发送备份 `activate` + `capture-text`
- 数据保留：25 个会话 / 2 个工作区 / 未发送备份索引 / 迁移队列与 2 份迁移备份

刷新插件页应看到：**一个「会话功能增强」条目，包含 5 个组件**（删除已归档会话 / 会话移动到工作区 / 未发送内容备份 / 会话历史搜索，各自原图标）。

验证细节见 [`verification/README.md`](verification/README.md) 与 [`verification/pack-evidence.json`](verification/pack-evidence.json)。

## 已知边界（继承原插件）

- 打开过的会话不能即时移动：排队，重启 DSH 后完成；
- 删除归档会话不可恢复；
- 未发送备份在发送成功后清理、切换/重启后恢复；
- 三者都只支持当前会话格式 v4。


## 分发给其他人

打包（会自动把 `components/` 同步到 `node_modules/`，再生成 zip）：

```powershell
node tools/build-dist.cjs
```

产物：[dist/dsh-session-toolkit-2.0.0.zip](dist/dsh-session-toolkit-2.0.0.zip)（约 55 KB，自包含：三个组件已放在包内 `node_modules/`，收件人不需要任何额外依赖或 profile 改动）。

收件人安装步骤见压缩包里的 `安装说明.md`：解压到固定目录 → DSH 插件页「添加插件 → 本地目录」选中解压出的文件夹 → 刷新。注意目录不能移动/删除（DSH 以链接方式安装本地目录）。
