# 项目开发约定

## 版本管理

- 对外版本从 `0.1.0` 起算，主包与所有组件的版本号保持一致。
- **版本号由用户决定**：什么时候改、改成哪个号，都等用户主动说，不自行递增。
- **实验性改动不改版本号**：保持当前版本号，只加 `-alpha.N` 后缀（例如 `0.1.2-alpha.1`），
  发布时挂非 `latest` 的 dist-tag，不影响正式用户。
- 只有**组件代码**发生实质变化（修 bug 攒成一批、增加功能）才值得新的正式版本；
  只改文档、构建脚本、安装脚本这类不算。
- 新增组件属于结构性变化，递增 `0.x.0`，同样等用户确认。
- 这些规则只维护在本文件中。README 面向安装和使用；CHANGELOG 只记录各版本的实际变更，不写版本管理约定。

## 发布与推送

- **npm 发布和 GitHub 推送都必须先得到用户明确同意**：`npm publish`、`git push`、推送 tag、GitHub Release 上传，一律不得自行执行。
- 准备发布时，先给出「版本号 + 改动清单 + 将要执行的命令」，等用户明确说「传」再执行。
- **git 也不要为一点点变化就动**：`commit` 攒成一批再做，打 tag 和推送远程一律先确认。
- npm 上的版本一旦发布就无法干净撤回，所以宁可多问一次。
- **Release / 版本标题只写版本号本身**（如 `0.1.3`），不要在版本号后面追加「— 修复了什么」之类的梗概；改动说明放正文。

## 发布前的验证门槛

- 结论必须对着**产物**验证，不能对着工作区：用户拿到的是 tarball / zip，不是源码。
- 发布前：`node verification/verify-release.mjs --local`（对 `pnpm pack` 出来的 6 个 tarball 做全量检查）。
- 发布后：`node verification/verify-release.mjs --version <版本> --tag <tag> --install`（从 registry 下载、装进临时 profile 再检查）。
- **安装路径也必须跑**：`DSH_BIN=<dsh> node verification/install-paths.test.mjs`。它用真实安装脚本装进临时 profile，
  覆盖「全新 profile」「组件被钉在旧版本」两种场景，两种脚本各自一遍；产物检查查不出安装器把组件漏掉，
  0.1.3 就是这样让用户装成了「主包新版 + 组件旧版」。
- 检查覆盖踩过的坑：浏览器半边的模块 id 必须等于包名（0.1.2 就是这里坏了）、宿主半边只 import `node:`、
  pack 的依赖恰好是五个组件且版本一致、tarball 里没有 `node_modules`、图标与语言文件齐全。
- 全绿之前不报告完成，也不让用户去拉。
- `install-paths.test.mjs` 的 registry 场景在**发布前必然失败**（版本还没上架），这是预期的；看它时必须确认失败的只有 registry 分支、zip 场景和其余检查全绿。发布后这一项要转为通过。
- 钉旧版用的基线版本取自已发布的 `OLDER_VERSION`（默认 0.1.3），不要用「当前版本减一」去推。

## 宿主兼容

- 每个包必须声明 `engines.dsh`（`>=floor <ceiling`），审计会拿当前运行时校验。
- 升级宿主前先跑 `verification/host-compat.test.mjs` 和 `verify-release.mjs --local`。

## 两个已经吃过亏的硬约束

- **客户端半边加载失败是 web 启动的致命错误**：DSH 会直接崩（`web boot: N entries did not activate`），
  不是像"未运行"那样温和。所以任何客户端改动都必须让每个 bundle 能按**包名**注册。
- **不要手改 profile 里的 `node_modules`**：pnpm 用硬链接把包链到内容寻址存储（一个文件多个 inode 共享），
  原地改写会污染 store，下一次 install 的完整性校验会把改动**还原回去**，把已修好的环境重新弄坏。
  要改就发新版本、走正常安装。
