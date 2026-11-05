/**
 * Build the sendable distribution of the Session Enhancements pack.
 *
 * 1. Re-vendor `plugin/components/<pkg>` into `plugin/node_modules/<pkg>` so the
 *    installed pack resolves its component packages from its own directory
 *    (no profile dependency wiring needed on the recipient machine).
 * 2. Stage a clean folder that contains only runtime files + the install note.
 * 3. Zip it to `dist/dsh-session-toolkit-<version>.zip`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN = path.join(ROOT, "plugin");
const COMPONENTS = path.join(PLUGIN, "components");
const DIST = path.join(ROOT, "dist");
const STAGE_NAME = "dsh-session-toolkit";

const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, "package.json"), "utf8"));
const version = manifest.version;
const stageRoot = path.join(DIST, "stage", `${STAGE_NAME}-${version}`);
const zipPath = path.join(DIST, `${STAGE_NAME}-${version}.zip`);

function copyDir(from, to) {
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, { recursive: true });
}

/**
 * Path segments that only serve a dependency's own tooling: TypeScript sources,
 * tests, examples and docs. None of them can be reached by an `import` at
 * runtime, and `zod/src/**` alone was 2.9 MB of the vendored tree.
 */
const DROP_DIRS = new Set(["src", "test", "tests", "__tests__", "examples", "example", "docs", "doc", "coverage", "benchmarks", "bench"]);
/** Files that only serve a dependency's own tooling; LICENSE and package.json stay. */
const DROP_FILE = /^(readme|changelog|history|contributing|authors|notice)(\.|$)/i;
/** Type declarations and source maps are never loaded at runtime. */
const DROP_EXT = /\.(d\.ts|d\.cts|d\.mts|map)$/i;
/** Packages declared as dependencies that no runtime file imports (checked below). */
const UNUSED_PACKAGES = ["zod"];
/** Subdirectories of a package that its own runtime entry never imports. */
const DROP_SUBPATHS = new Map([
	// `zod`'s root entry re-exports v4 only; dsh-llm imports the bare specifier.
	["zod", new Set(["v3", "mini", "v4-mini", "locales"])],
]);

/** Runtime files under one directory that import (or require) `name`. */
function runtimeImporters(root, name) {
	const pattern = new RegExp(`(?:from\\s*['"]${name}(?:/[^'"]*)?['"]|require\\(\\s*['"]${name}(?:/[^'"]*)?['"]\\s*\\))`);
	const hits = [];
	const walk = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === name || DROP_DIRS.has(entry.name)) continue;
				walk(full);
				continue;
			}
			if (!/\.(m?js|cjs)$/i.test(entry.name)) continue;
			if (pattern.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(root, full));
		}
	};
	walk(root);
	return hits;
}

/**
 * Copy the vendored dependencies for distribution.
 *
 * The vendored tree starts as whatever pnpm put on disk: nested `node_modules`
 * copies, TypeScript sources, declaration files and readmes. A recipient needs
 * only the runtime files, so this drops everything an `import` cannot reach. A
 * package is dropped whole only when no runtime file imports it — verified here
 * rather than assumed, so a future component that does import it keeps it.
 */
function copyRuntimeTree(from, to) {
	const dropped = [];
	for (const name of UNUSED_PACKAGES) {
		const importers = runtimeImporters(from, name);
		if (importers.length === 0) dropped.push(name);
		else console.log(`keep ${name}: imported by ${importers.slice(0, 3).join(", ")}`);
	}
	const packageOf = (segments) =>
		segments[0].startsWith("@") && segments.length > 1 ? `${segments[0]}/${segments[1]}` : segments[0];
	const keep = (source) => {
		const relative = path.relative(from, source);
		if (relative === "") return true;
		const segments = relative.split(path.sep);
		// Nested node_modules only exist because pnpm hoists per version; the flat
		// tree this script stages resolves the same versions (zod 4.x satisfies ^4.4.3).
		if (segments.length > 1 && segments.includes("node_modules")) return false;
		if (dropped.includes(packageOf(segments))) return false;
		const subpaths = DROP_SUBPATHS.get(packageOf(segments));
		if (subpaths !== undefined && segments.length > 1 && subpaths.has(segments[1])) return false;
		const base = segments[segments.length - 1];
		if (DROP_DIRS.has(base)) return false;
		if (DROP_FILE.test(base) || DROP_EXT.test(base) || /\.md$/i.test(base)) return false;
		return true;
	};
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, { recursive: true, filter: keep });
	if (dropped.length > 0) console.log(`dropped unused vendored packages: ${dropped.join(", ")}`);
}

/* 1. Re-vendor components into the pack's own node_modules. */
const vendored = path.join(PLUGIN, "node_modules");
fs.mkdirSync(vendored, { recursive: true });
for (const entry of fs.readdirSync(COMPONENTS, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const source = path.join(COMPONENTS, entry.name);
	const manifestFile = path.join(source, "package.json");
	const component = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
	if (component.dsh?.bundle !== undefined) {
		throw new Error(`${entry.name} still declares dsh.bundle; components must be plain packages`);
	}
	copyDir(source, path.join(vendored, entry.name));
	console.log(`vendored ${entry.name}@${component.version}`);
}

/* 2. Stage runtime files + install note. */
fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });
for (const file of ["package.json", "cordis.patch.yml", "icon.svg", "README.md"]) {
	fs.copyFileSync(path.join(PLUGIN, file), path.join(stageRoot, file));
}
for (const directory of ["lib", "locale"]) {
	copyDir(path.join(PLUGIN, directory), path.join(stageRoot, directory));
}
copyRuntimeTree(path.join(PLUGIN, "node_modules"), path.join(stageRoot, "node_modules"));
const noteSource = fs.existsSync(path.join(DIST, "安装说明.md"))
	? path.join(DIST, "安装说明.md")
	: path.join(ROOT, "安装说明.md");
if (!fs.existsSync(noteSource)) throw new Error("安装说明.md is missing");
fs.copyFileSync(noteSource, path.join(stageRoot, "安装说明.md"));

/* 3. Zip (PowerShell Compress-Archive keeps the folder structure portable). */
fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(zipPath, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stageRoot}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`], { stdio: "inherit" });

const { createHash } = require("node:crypto");
const bytes = fs.readFileSync(zipPath);
/** Total bytes and file count of one directory tree. */
function measure(directory) {
	let total = 0;
	let files = 0;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			const nested = measure(full);
			total += nested.bytes;
			files += nested.files;
			continue;
		}
		total += fs.statSync(full).size;
		files += 1;
	}
	return { bytes: total, files };
}
const staged = measure(stageRoot);
console.log(`\nzip: ${zipPath}`);
console.log(`size: ${bytes.length} bytes`);
console.log(`staged raw: ${staged.bytes} bytes in ${staged.files} files`);
console.log(`sha256: ${createHash("sha256").update(bytes).digest("hex").toUpperCase()}`);
console.log(`staged: ${stageRoot}`);
