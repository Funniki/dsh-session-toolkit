# 长文本转附件（dsh-auto-paste 组件）

粘贴超过阈值的长文本时，自动保存为当前会话工作区 `pastes/` 下的附件，输入框里只留一张带**开头预览**的引用卡片；模型收到的是 `@"pastes/xxx.md"` 这样一行引用，不占上下文。

**零依赖重写版（2.0.0）**：组件不再 import 任何 `@deepseek-ai/*` 包，也不再自带 `node_modules` 依赖树。

- Host 半边（`lib/host.js`）：只 import `node:fs/promises`、`node:os`、`node:path`。
- 浏览器半边（`dist/client.js`）：只 `require('react')`（DSH 页面自带的平台模块）。

之所以重写：上一版通过 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/schemastery` 实现工具与 RPC，这几个包会把 DSH 核心再复制一份进包里；两份核心的调度器 Symbol 对不上，插件工具就整体失效。现在宿主侧改用 **`connection` 路由 + `tools` 服务**（与包内其它四个组件同一套机制），浏览器侧用普通 `fetch` 调这几条路由，于是整包不需要任何第三方代码。

## 实现要点

| 能力 | 现在怎么实现 |
|---|---|
| 粘贴拦截、阈值判断 | `document` 捕获阶段 `paste` 监听（未变） |
| 落盘 | `POST api/auto-paste.save` → 宿主写 `<工作区>/pastes/<slug>.<md\|txt>` |
| 引用卡片 | 提交路径上 `controller.serializeReference('reference', …)` + `composer.insertReference`（未变） |
| 阈值读取/保存 | `POST api/auto-paste.config` / `POST api/auto-paste.threshold` |
| 阈值持久化 | `$DSH_HOME/auto-paste/user-config.json`（原子写入：临时文件 + rename） |
| `save_paste` 工具 | 直接构造 `ctx.tools.register()` 需要的定义，JSON Schema 是原先 `defineTool` 编译结果的字面量 |

三条路由都注册在共享的 `connection` Fetch 通道上（`methods: ["POST"]`、`requestBody: "buffered"`），和 `archived-session-delete`、`session-move` 等组件的做法一致。

## 配置

组件行的 `config`：

```yaml
- id: auto-paste
  name: 'dsh-auto-paste'
  config:
    minChars: 500        # 触发阈值（字符）
    maxBytes: 1048576    # 单次粘贴字节上限（硬顶 64 MiB）
```

也可以在 **设置 → 通用 → 大段粘贴阈值** 即时修改（写入上面那个 JSON 文件，下一次启动仍然生效）。

## 行为

- 粘贴 ≥ `minChars` → 文本写入 `<工作区>/pastes/<slug>.<md|txt>`（内容像 Markdown 就 `.md`，否则 `.txt`）；
- 输入框插入官方引用卡片（atomic chip），标签带开头预览与字符数，点击右侧栏打开；
- 消息发送后模型只收到 `@"pastes/xxx.md"` 引用；
- 同名文件不覆盖：依次尝试 `<slug>-1`、`<slug>-2` …；
- 保存失败自动回退为原文粘贴，不丢内容。

## 验证

`verification/auto-paste-zero-dep.test.mjs` 用一个假的插件上下文直接加载 `lib/host.js`，覆盖：路由注册、`.md`/`.txt` 判定、同名重命名、工作区解析、超限拒绝、阈值读写与重启后保留、工具 JSON Schema 形状、`save_paste` 落盘与 label 校验。

```bash
node verification/auto-paste-zero-dep.test.mjs
```

## 归属

浏览器半边的编辑器/插入逻辑沿用 [`dsh-auto-paste@0.3.2`](https://github.com/sakuraqqq/dsh-auto-paste)（MIT，作者 misakamaster）的实测结论；MIT 许可与第三方声明见同目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`。
