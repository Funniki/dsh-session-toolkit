/**
 * Build the distributable tarball of the Session Enhancements pack.
 *
 * The pack is a real npm package now: its manifest sits at the repository root,
 * `dsh.bundle.patch` points inside the package, and every bundle row uses a
 * RELATIVE path, so the components travel inside the tarball and resolve
 * wherever it is unpacked. That means no vendored dependency tree and no
 * `plugin/node_modules` staging — `pnpm pack` already produces exactly the
 * artifact an install consumes.
 *
 * Usage:
 *   node tools/build-dist.cjs            # pack only
 *   node tools/build-dist.cjs --publish  # pack, then publish to the registry
 *                                        # (requires `npm login`, or NPM_TOKEN)
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** The Node + pnpm the desktop app itself runs, with a PATH fallback. */
function runtime() {
	const base = path.join(process.env.USERPROFILE ?? "", ".dsh", "dsh-runtimes", "dsh-primary-runtime", "dependencies");
	const node = path.join(base, "node", "bin", "node.exe");
	const pnpm = path.join(base, "pnpm", "bin", "pnpm.cjs");
	if (fs.existsSync(node) && fs.existsSync(pnpm)) return { node, pnpm };
	return { node: process.execPath, pnpm: undefined };
}

/** Run pnpm, inheriting stdio so its output reaches the caller. */
function runPnpm(args) {
	const { node, pnpm } = runtime();
	if (pnpm === undefined) throw new Error("pnpm not found; run `pnpm` from PATH instead");
	execFileSync(node, [pnpm, ...args], { cwd: ROOT, stdio: "inherit" });
}

for (const stale of fs.readdirSync(ROOT)) {
	if (!stale.endsWith(".tgz")) continue;
	fs.rmSync(path.join(ROOT, stale), { force: true });
}

runPnpm(["pack"]);

const tarball = fs.readdirSync(ROOT).find((name) => name.endsWith(".tgz"));
if (tarball === undefined) throw new Error("pnpm pack produced no tarball");
const bytes = fs.readFileSync(path.join(ROOT, tarball));
console.log(`\ntarball: ${tarball}`);
console.log(`name: ${manifest.name}`);
console.log(`version: ${manifest.version}`);
console.log(`size: ${bytes.length} bytes`);
console.log(`sha256: ${createHash("sha256").update(bytes).digest("hex").toUpperCase()}`);

if (process.argv.includes("--publish")) {
	if (manifest.private === true) throw new Error("package.json is private; publishing would fail");
	runPnpm(["publish", "--access", "public", "--no-git-checks"]);
	console.log(`\npublished ${manifest.name}@${manifest.version}`);
}
