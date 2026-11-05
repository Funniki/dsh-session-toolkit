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
for (const directory of ["lib", "locale", "node_modules"]) {
	copyDir(path.join(PLUGIN, directory), path.join(stageRoot, directory));
}
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
console.log(`\nzip: ${zipPath}`);
console.log(`size: ${bytes.length} bytes`);
console.log(`sha256: ${createHash("sha256").update(bytes).digest("hex").toUpperCase()}`);
console.log(`staged: ${stageRoot}`);
