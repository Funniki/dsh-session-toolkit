#!/usr/bin/env node
/**
 * Release build for dsh-session-toolkit.
 *
 * One command does the three things a release needs, in the only order that
 * keeps the package honest:
 *
 *   1. mirror `components/<pkg>` into `plugin/node_modules/<pkg>` — the pack
 *      ships those five copies and installs them as profile dependencies, so a
 *      stale copy is a broken install for whoever downloads the zip;
 *   2. audit the result: the whole pack must carry zero third-party code (the
 *      2.3.x releases bundled a copy of the Harness core inside the pack, and
 *      two cores in one process is what killed every tool call);
 *   3. zip `plugin/` contents into `dist/dsh-session-toolkit-<version>.zip`.
 *
 * Usage:
 *   node tools/build-release.cjs           # sync + audit + zip
 *   node tools/build-release.cjs --check   # sync + audit, no zip
 */

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN = path.join(ROOT, "plugin");
const COMPONENTS = path.join(ROOT, "components");
const DIST = path.join(ROOT, "dist");

/** Node builtin prefixes a host half may import. */
const HOST_ALLOWED = /^node:/;
/** Module ids a browser half may require: platform seeds and DSH client packages. */
const CLIENT_ALLOWED = /^(react|react\/jsx-runtime|@deepseek-ai\/dsh-client-[a-z-]+)$/;

const errors = [];
const notes = [];

/** Read one JSON file. @param file - absolute path. @returns the parsed value. */
function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** @returns the pack manifest. */
function packManifest() {
	return readJson(path.join(PLUGIN, "package.json"));
}

/**
 * Mirror every component source into the pack's bundled copies.
 * @returns the component package names, in directory order.
 */
function syncComponents() {
	const names = fs
		.readdirSync(COMPONENTS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const target = path.join(PLUGIN, "node_modules");
	fs.mkdirSync(target, { recursive: true });
	for (const name of names) {
		const from = path.join(COMPONENTS, name);
		const to = path.join(target, name);
		fs.rmSync(to, { recursive: true, force: true });
		fs.cpSync(from, to, { recursive: true });
		notes.push(`synced ${name}`);
	}
	return names;
}

/**
 * Drop comments so prose that mentions a module name cannot look like a real
 * import (the browser half documents reasons such as "…cannot tell 'never
 * installed' from 'reloading'" — those lines used to fail the audit).
 * @param source - file text.
 * @returns the text without block comments and whole-line `//` comments.
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.map((line) => (line.trimStart().startsWith("//") ? "" : line))
		.join("\n");
}

/**
 * Collect module specifiers a script imports or requires.
 * @param source - file text.
 * @returns every specifier found.
 */
function specifiersOf(source) {
	const found = new Set();
	const code = stripComments(source);
	for (const match of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) found.add(match[1]);
	for (const match of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.add(match[1]);
	for (const match of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.add(match[1]);
	return [...found];
}

/**
 * Audit one component's host and browser halves.
 * @param name - component package name.
 * @param dir - the component directory inside the pack.
 */
function auditComponent(name, dir) {
	const manifest = readJson(path.join(dir, "package.json"));
	const hostRel = manifest.main;
	if (typeof hostRel !== "string") {
		errors.push(`${name}: package.json declares no main (host half)`);
	} else {
		const hostPath = path.join(dir, hostRel);
		if (!fs.existsSync(hostPath)) errors.push(`${name}: host half is missing at ${hostRel}`);
		else {
			for (const specifier of specifiersOf(fs.readFileSync(hostPath, "utf8"))) {
				if (!HOST_ALLOWED.test(specifier)) {
					errors.push(`${name}: host half imports "${specifier}" — only node: builtins are allowed`);
				}
			}
		}
	}
	const clientRel = manifest.exports && manifest.exports["./client"];
	const clientPath = typeof clientRel === "string" ? path.join(dir, clientRel) : undefined;
	if (clientPath !== undefined) {
		if (!fs.existsSync(clientPath)) errors.push(`${name}: browser half is missing at ${clientRel}`);
		else {
			for (const specifier of specifiersOf(fs.readFileSync(clientPath, "utf8"))) {
				if (!CLIENT_ALLOWED.test(specifier)) {
					errors.push(`${name}: browser half requires "${specifier}" — only react and @deepseek-ai/dsh-client-* are allowed`);
				}
			}
		}
	}
	if (manifest.license !== "MIT") errors.push(`${name}: license must be MIT (got ${JSON.stringify(manifest.license)})`);
}

/**
 * Assert the pack bundles nothing but its own components.
 * @param componentNames - the component package names.
 */
function auditPack(componentNames) {
	const bundled = path.join(PLUGIN, "node_modules");
	const entries = fs.readdirSync(bundled, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith("@")) {
			errors.push(`pack bundles a scoped package (${entry.name}) — a second copy of a dependency inside the pack is exactly the 2.3.x failure mode`);
			continue;
		}
		if (!componentNames.includes(entry.name)) {
			errors.push(`pack bundles an unexpected package (${entry.name})`);
		}
	}
	const pack = packManifest();
	if (pack.license !== "MIT") errors.push(`pack: license must be MIT (got ${JSON.stringify(pack.license)})`);
	if (pack.private === true) errors.push("pack: package.json is still private — it cannot be published");
	if (pack.dependencies !== undefined) {
		errors.push(`pack: declares dependencies ${JSON.stringify(pack.dependencies)} — the pack must be dependency-free`);
	}
	if (!fs.existsSync(path.join(PLUGIN, "LICENSE"))) errors.push("pack: LICENSE is missing");
	const rows = fs.readFileSync(path.join(PLUGIN, "cordis.patch.yml"), "utf8");
	for (const name of componentNames) {
		if (!rows.includes(`name: '${name}'`) && !rows.includes(`name: "${name}"`) && !rows.includes(`name: ${name}`)) {
			errors.push(`cordis.patch.yml declares no row for ${name}`);
		}
	}
}

/**
 * Zip the pack contents into `dist/`.
 * @param version - pack version.
 * @returns the archive path.
 */
function writeZip(version) {
	fs.mkdirSync(DIST, { recursive: true });
	const out = path.join(DIST, `dsh-session-toolkit-${version}.zip`);
	fs.rmSync(out, { force: true });
	if (process.platform === "win32") {
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				`Compress-Archive -Path '${path.join(PLUGIN, "*").replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -CompressionLevel Optimal`
			],
			{ stdio: "pipe" }
		);
	} else {
		execFileSync("zip", ["-qr", out, "."], { cwd: PLUGIN, stdio: "pipe" });
	}
	return out;
}

function main() {
	const checkOnly = process.argv.includes("--check");
	const componentNames = syncComponents();
	for (const name of componentNames) auditComponent(name, path.join(PLUGIN, "node_modules", name));
	auditPack(componentNames);

	for (const note of notes) console.log(`  ${note}`);
	console.log(`\naudit: ${errors.length === 0 ? "clean" : `${errors.length} problem(s)`}`);
	for (const error of errors) console.error(`  ✗ ${error}`);
	if (errors.length > 0) process.exit(1);

	const pack = packManifest();
	if (checkOnly) {
		console.log(`\nchecked dsh-session-toolkit@${pack.version} (no archive written)`);
		return;
	}
	const archive = writeZip(pack.version);
	const size = fs.statSync(archive).size;
	console.log(`\nwrote ${path.relative(ROOT, archive)} (${(size / 1024).toFixed(1)} KB)`);
}

main();
