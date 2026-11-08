# 把五个组件的旧版本（0.1.0 ~ 0.1.4）标记为废弃。
#
# 为什么不能直接删：npm 的策略拒绝撤回"被其他包依赖"的版本，而主包 0.1.5 依赖这些
# 组件，所以 25 个旧版本都无法 unpublish（405 has dependent packages）。
# npm 自己给出的替代方案就是 deprecate。
#
# 好处：一条命令覆盖一个组件的全部旧版本（用 @<0.1.5 范围），共 5 条，只需碰 5 次钥匙。
# 效果：这些版本会带 deprecated 标记，npm 页面和 npm install 都会显示警告。
#
# 用法：
#   cd C:\Users\G1enn\Documents\deepseek-harness\default-workspace\session-toolkit\tools
#   powershell -ExecutionPolicy Bypass -File .\deprecate-legacy.ps1

$ErrorActionPreference = "Continue"

$node = "C:\Program Files\nodejs\node.exe"
$npmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"

if (-not (Test-Path -LiteralPath $node)) { throw "找不到 node: $node" }
if (-not (Test-Path -LiteralPath $npmCli)) { throw "找不到 npm CLI: $npmCli" }

$components = @(
	"archived-session-delete",
	"session-move",
	"unsent-content-guard",
	"session-history-search",
	"auto-paste"
)
$message = "Broken release (0.1.0-0.1.4): the client halves registered the pre-rename module id and the backup store called missing methods. Use 0.1.5."

Write-Host "共 5 条，每条覆盖一个组件的全部旧版本（<0.1.5）。" -ForegroundColor Cyan
Write-Host "每条需要按一次 ENTER 并碰一下安全密钥。" -ForegroundColor DarkGray
Write-Host ""

$done = 0
$failed = @()

foreach ($component in $components) {
	$spec = "@funniki/dsh-session-toolkit-$component@<0.1.5"

	$answer = Read-Host "标记废弃 $spec ? (回车继续 / s 跳过 / q 退出)"
	if ($answer -eq "q") { Write-Host "已退出。" -ForegroundColor Yellow; break }
	if ($answer -eq "s") { continue }

	& $node $npmCli deprecate $spec $message
	if ($LASTEXITCODE -eq 0) {
		$done++
		Write-Host "  ✓ 已标记" -ForegroundColor Green
	} else {
		$failed += $spec
		Write-Host "  ✗ 失败" -ForegroundColor Red
	}
}

Write-Host ""
Write-Host "================ 汇总 ================" -ForegroundColor Cyan
Write-Host "成功: $done / $($components.Count)"
if ($failed.Count -gt 0) {
	Write-Host "失败:" -ForegroundColor Red
	$failed | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "跑完告诉我，我来核对每个旧版本是否都带上了 deprecated 标记。" -ForegroundColor Cyan
