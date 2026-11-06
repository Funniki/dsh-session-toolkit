# 会话功能增强 · dsh-session-toolkit

给 DeepSeek Harness 加五个会话管理能力：删已归档会话、把会话搬到别的工作区、备份没发出去的内容、按关键词搜历史、长文粘成附件。

**一个插件包（pack）+ 五个组件，零第三方依赖** —— 整个包只用到 Node 内置模块和 DSH 页面自带的 `react`，不往里塞任何 `@deepseek-ai/*` 副本。

当前版本 **0.1.0**。

| 组件 | 显示名 | 做什么 | 出现在 |
|---|---|---|---|
| `dsh-archived-session-delete` | 删除已归档会话 | 侧栏已归档会话上出现红色删除按钮，连同磁盘上的会话日志一起删 | 侧栏行 + 会话菜单 |
| `dsh-session-move` | 会话移动到工作区 | 把会话（含日志、附件）搬到另一个工作区，带备份、校验和失败回滚；开着也能搬 | 会话菜单 |
| `dsh-unsent-content-guard` | 未发送内容备份 | 没发出去的输入和图片落盘备份，成功发送后才删 | 后台自动 |
| `dsh-session-history-search` | 会话历史搜索 | 中文关键词搜历史消息，结果小窗 | 搜索入口 |
| `dsh-auto-paste` | 长文本转附件 | 粘贴超过阈值的长文本自动存成工作区 `pastes/*.md` / `*.txt`，输入框只留一张带预览的卡片 | 输入框 + 设置页 |

## ⚠️ 安装：必须装 6 个包，只装 pack 会全部失效

这不是啰嗦，是 DSH 的机制：bundle 行（`cordis.patch.yml` 里每条的 `name`）**只从 profile 根解析**，pack 自带的 `node_modules/` 对行解析不可见。所以：

- 只安装 `dsh-session-toolkit` → 插件列表里关联的五行全是「未运行」；
- 必须把 pack 和 5 个组件都装进 profile。

`install.ps1` 已经把 6 次安装串成一条命令，正常情况下你不需要手动敲。

### Windows 一键安装

1. 下载 `dsh-session-toolkit-0.1.0.zip`，解压到一个**固定位置**（例如 `C:\Users\<你>\dsh-plugins\dsh-session-toolkit-0.1.0`）。安装走的是本地链接（`link:`），之后**不要删这个目录、也不要移动它**。
2. 在该目录里跑：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

3. 重启 DSH（或到 插件 页把「会话功能增强」关掉再打开）。

### 手动安装（任何平台）

在解压出来的目录里逐条执行（`$root` 换成实际路径）：

```bash
dsh plugin --profile desktop add "$root"
dsh plugin --profile desktop add "$root/node_modules/dsh-archived-session-delete"
dsh plugin --profile desktop add "$root/node_modules/dsh-session-move"
dsh plugin --profile desktop add "$root/node_modules/dsh-unsent-content-guard"
dsh plugin --profile desktop add "$root/node_modules/dsh-session-history-search"
dsh plugin --profile desktop add "$root/node_modules/dsh-auto-paste"
```

> 顺序无所谓，但六个都要在。`dsh plugin` 是 `pnpm` 的转发器，所以等 npm 渠道发布后，也可以直接 `add` npm 包名。

### 装完怎么确认

- 插件页出现一个「会话功能增强」，点开「包含的组件」有 5 条，且都不是「未运行」；
- `%DSH_HOME%\profiles\desktop\package.json`（macOS/Linux 是 `~/.dsh/...`）里 `dependencies` 有上面 6 个键，`dsh.profile.bundles` 里有 `dsh-session-toolkit`；
- profile 的 `node_modules` 里**不应**出现 `@deepseek-ai/dsh-tools` 这类核心包（出现说明另有插件把核心带进了 profile，与本包无关，但会污染环境）。

### 卸载

首选**插件页 → 会话功能增强 → 移除**（管理器和 profile 清单会一起收尾）。命令行卸载会留下 `dsh.profile.bundles` 里的悬空条目，需要再到插件页清一次。

## 配置

每个组件的行配置写在 pack 的 `cordis.patch.yml` 里，装好后由 DSH 收进 profile 的 patch，可直接在 profile 里改。当前只有 `auto-paste` 带配置：

```yaml
- id: auto-paste
  name: 'dsh-auto-paste'
  config:
    minChars: 500        # 触发阈值（字符）
    maxBytes: 1048576    # 单次粘贴字节上限（硬顶 64 MiB）
```

`auto-paste` 的阈值也能在 **设置 → 通用 → 大段粘贴阈值** 里即时改（存到 `$DSH_HOME/auto-paste/user-config.json`）。

## 兼容性

- DSH `0.2.1-rc.5`（桌面版 / web 端）实测通过；组件用的都是跨版本相对稳定的公开面（Loader 行、`connection` Fetch 通道、`tools` 服务、client slots）。
- `install.ps1` 是 Windows 脚本；其他平台用上面的手动命令。
- 浏览器半边依赖 DSH 自己的 composer 与 slots；DSH 大改版时可能需要在版本号里跟进。

## 仓库结构

```
session-toolkit/
├── plugin/                     # 发布产物（pack 根；zip 里就是这个目录的内容）
│   ├── package.json            # dsh.bundle.patch → cordis.patch.yml
│   ├── cordis.patch.yml        # 5 条 insert，每条 name 指向一个组件包
│   ├── install.ps1             # 一键安装（6 次 dsh plugin add）
│   ├── LICENSE / README.md / 安装说明.md
│   ├── lib/ locale/ icon.svg   # pack 自身的空模块与显示元数据
│   └── node_modules/dsh-*/     # 随包分发的 5 个组件（由 components/ 同步而来）
├── components/                 # 5 个组件的源码（改这里，不要直接改 plugin/node_modules）
├── dist/                       # 构建产物 zip（git 忽略）
├── tools/build-release.cjs     # 同步组件 + 零依赖审计 + 打 zip
├── verification/               # 可独立运行的验证脚本
├── CHANGELOG.md
└── LICENSE
```

## 开发与发布

```bash
node tools/build-release.cjs --check              # 同步 components/ → plugin/node_modules/ 并做零依赖审计
node tools/build-release.cjs                      # 再额外产出 dist/dsh-session-toolkit-<版本>.zip
node verification/auto-paste-zero-dep.test.mjs    # auto-paste 宿主半边的行为测试
node verification/verify-profile.mjs              # 装完后的体检：6 个依赖、5 条 row 能否 import、有没有核心副本
```

审计会拦住三类回归：包里出现带作用域的依赖、宿主半边 import 了非 `node:` 模块、浏览器半边 require 了 `react` / `@deepseek-ai/dsh-client-*` 之外的东西。

> `plugin/node_modules/`（随包分发的 5 个组件副本）被 git 忽略，由上面的脚本从 `components/` 生成。所以**从仓库直接装之前先跑一次** `node tools/build-release.cjs --check`；拿 Release 里的 zip 安装则不需要，zip 里已经带好了。

## 版本约定

- `0.1.0` 是首个对外版本；
- 修 bug 攒成一批后涨 `0.1.x`；加组件涨 `0.x.0`；
- 详见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。`dsh-auto-paste` 组件的浏览器半边沿用上游 [`dsh-auto-paste@0.3.2`](https://github.com/sakuraqqq/dsh-auto-paste)（MIT，作者 misakamaster）的实现结论，其许可与第三方声明见 `plugin/node_modules/dsh-auto-paste/`。
