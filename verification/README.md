# 0.1.0 发布验证

本目录说明 `dsh-session-toolkit` 及五个组件的验证范围。历史内部版本的记录不代表当前版本的端到端验收。

## 发布构建与依赖审计

从仓库根目录运行：

```sh
node tools/build-release.cjs
```

脚本先将 `components/` 同步到 `plugin/node_modules/`，再检查依赖及宿主、客户端入口，并生成 `dist/dsh-session-toolkit-0.1.0.zip`。`--check` 同样会同步组件，只是不生成 ZIP，并非只读操作。

0.1.0 的发布包包含主包、五个组件、MIT 许可证和安装脚本；不包含第三方运行时依赖或 DSH 核心副本。ZIP 使用正斜杠条目路径和固定时间戳。依赖审计是静态检查，不能代替运行测试或浏览器交互验证。

## 自动化行为测试

```sh
node verification/auto-paste-zero-dep.test.mjs
node verification/hot-move-harness.mjs
```

- `auto-paste-zero-dep.test.mjs`：使用模拟插件上下文测试宿主模块。22 项检查涵盖内置模块引用、路由和工具定义、Markdown/文本落盘、同名避让、工作区解析、超限拒绝、阈值校验及持久化。
- `hot-move-harness.mjs`：使用临时会话目录及模拟 registry/persistence，验证冷迁移、热迁移、dry-run、迁移前后刷盘、工作目录更新，以及运行中会话被拒绝且 header 不变。

两组测试在此次发布检查中均通过。它们不移动用户真实会话，也不证明真实浏览器中的所有交互都通过。

## 安装后验证

解压发布包并运行 `install.ps1` 后，在源码仓库中执行：

```sh
node verification/verify-profile.mjs --profile desktop
```

该脚本检查六个依赖是否记录在同一 profile、主包是否注册为 bundle、六个宿主入口能否从 profile 根解析并实际导入，以及 profile 是否存在重复的 `@deepseek-ai/dsh-tools`。已有 profile 中的其他插件仅作信息展示，不视为本插件的依赖。

此次发布复查中，本机 desktop profile 的主包及五个组件均为 0.1.0，全部导入通过，未发现上述核心副本。此前开发验证还使用解压包的安装脚本完成过全新 profile 安装；本次复查没有重新安装到用户的活动 profile。

## 仍需人工验收的交互

- 真实输入框中粘贴长文本，确认落盘、引用卡片和提示形成完整链路。
- 插件页显示五个组件的名称、图标与运行状态，组件开关可用。
- 会话菜单移动入口、归档删除、未发送内容恢复以及历史搜索与结果跳转。

浏览器真实 Ctrl+V 到引用卡片的链路尚未在此次发布检查中完成自动化验收。宿主测试、模块导入成功与界面验收是不同的验证范围。

## 历史材料

`pack-evidence.json`、`selftest-merged.json`、`verify-display-meta.cjs` 及未跟踪的 probe 日志属于早期调试材料。其中可能带旧版本、旧路径或本机 profile 假设；不作为 0.1.0 五个组件全部运行或端到端通过的证明。当前源码构建与安装检查以本页列出的脚本为准。
