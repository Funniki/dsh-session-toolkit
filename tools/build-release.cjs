#!/usr/bin/env node
/**
 * Release build for dsh-session-toolkit.
 *
 * One command does the three things a release needs, in the only order that
 * keeps the package honest:
 *
 *   1. mirror every `components/<dir>` into `plugin/node_modules/<its package
 *      name>` — the zip ships those five copies and installs them as profile
 *      dependencies, so a stale copy is a broken install for whoever downloads
 *      it (the package NAME decides the target path, which is why the scoped
 *      names flow through here instead of the directory names);
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

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN = path.join(ROOT, "plugin");
const COMPONENTS = path.join(ROOT, "components");
const DIST = path.join(ROOT, "dist");

/** What a component's host half may import: Node builtins only. */
const HOST_ALLOWED = /^node:/;
/** What a component's browser half may require: platform modules only. */
const CLIENT_ALLOWED = /^(react|react\/jsx-runtime|@deepseek-ai\/dsh-client-[a-z-]+)$/;
/** The pack's own name. */
const PACK_NAME = "@funniki/dsh-session-toolkit";

const errors = [];

/** @param file - absolute path. @returns the parsed JSON. */
function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** @returns the pack manifest. */
function packManifest() {
	return readJson(path.join(PLUGIN, "package.json"));
}

/**
 * Turn a package name into its path below `node_modules/`.
 * @param name - bare or scoped package name.
 * @returns the relative directory path.
 */
function nodeModulesPath(name) {
	return name.startsWith("@") ? path.join(...name.split("/")) : name;
}

/**
 * Read every component source directory.
 * @returns {{dir: string, name: string, version: string}[]} components, sorted by name.
 */
function components() {
	return fs
		.readdirSync(COMPONENTS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const manifest = readJson(path.join(COMPONENTS, entry.name, "package.json"));
			return { dir: entry.name, name: manifest.name, version: manifest.version };
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Mirror every component into the pack's bundled copies, dropping copies this
 * pack no longer ships (a rename would otherwise leave the old one behind).
 * @param list - components from `components()`.
 */
function syncComponents(list) {
	const bundled = path.join(PLUGIN, "node_modules");
	fs.mkdirSync(bundled, { recursive: true });
	const expected = new Set(list.map((component) => nodeModulesPath(component.name)));

	for (const top of fs.readdirSync(bundled, { withFileTypes: true })) {
		if (!top.isDirectory()) continue;
		if (!top.name.startsWith("@")) {
			if (!expected.has(top.name)) fs.rmSync(path.join(bundled, top.name), { recursive: true, force: true });
			continue;
		}
		const scopeDir = path.join(bundled, top.name);
		for (const child of fs.readdirSync(scopeDir, { withFileTypes: true })) {
			const rel = path.join(top.name, child.name);
			if (!expected.has(rel)) fs.rmSync(path.join(scopeDir, child.name), { recursive: true, force: true });
		}
		if (fs.readdirSync(scopeDir).length === 0) fs.rmSync(scopeDir, { recursive: true, force: true });
	}

	for (const component of list) {
		const to = path.join(bundled, nodeModulesPath(component.name));
		fs.rmSync(to, { recursive: true, force: true });
		fs.cpSync(path.join(COMPONENTS, component.dir), to, { recursive: true });
	}
}

/**
 * Drop comments so prose that mentions a module name cannot look like a real
 * import (the browser halves document such reasons in prose).
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
 * Audit one component's manifest and both halves.
 * @param name - component package name.
 * @param dir - the component directory inside the pack.
 */
function auditComponent(name, dir) {
	const manifest = readJson(path.join(dir, "package.json"));
	if (manifest.name !== name) errors.push(`${name}: bundled copy declares name ${JSON.stringify(manifest.name)}`);
	if (manifest.license !== "MIT") errors.push(`${name}: license must be MIT (got ${JSON.stringify(manifest.license)})`);
	if (manifest.publishConfig?.access !== "public") errors.push(`${name}: publishConfig.access must be "public"`);

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
	if (typeof clientRel === "string") {
		const clientPath = path.join(dir, clientRel);
		if (!fs.existsSync(clientPath)) errors.push(`${name}: browser half is missing at ${clientRel}`);
		else {
			for (const specifier of specifiersOf(fs.readFileSync(clientPath, "utf8"))) {
				if (!CLIENT_ALLOWED.test(specifier)) {
					errors.push(
						`${name}: browser half requires "${specifier}" — only react and @deepseek-ai/dsh-client-* are allowed`
					);
				}
			}
		}
	}
}

/**
 * Assert the pack bundles nothing but its own components, and that its patch
 * declares a row for each of them.
 * @param list - components from `components()`.
 */
function auditPack(list) {
	const bundled = path.join(PLUGIN, "node_modules");
	const expected = new Set(list.map((component) => nodeModulesPath(component.name)));
	for (const top of fs.readdirSync(bundled, { withFileTypes: true })) {
		if (!top.isDirectory()) continue;
		if (top.name.startsWith("@")) {
			for (const child of fs.readdirSync(path.join(bundled, top.name), { withFileTypes: true })) {
				const rel = path.join(top.name, child.name).replace(/\\/g, "/");
				if (!expected.has(path.join(top.name, child.name))) {
					errors.push(`pack bundles an unexpected scoped package (${rel})`);
				}
			}
			continue;
		}
		if (!expected.has(top.name)) errors.push(`pack bundles an unexpected package (${top.name})`);
	}
	for (const component of list) {
		if (!fs.existsSync(path.join(bundled, nodeModulesPath(component.name), "package.json"))) {
			errors.push(`pack is missing ${component.name}`);
		}
	}

	const pack = packManifest();
	if (pack.name !== PACK_NAME) errors.push(`pack: name must be ${PACK_NAME} (got ${JSON.stringify(pack.name)})`);
	if (pack.license !== "MIT") errors.push(`pack: license must be MIT (got ${JSON.stringify(pack.license)})`);
	if (pack.private === true) errors.push("pack: package.json is still private — it cannot be published");
	if (pack.publishConfig?.access !== "public") errors.push('pack: publishConfig.access must be "public"');
	// The pack depends on exactly its five components and nothing else: under the
	// profile's `nodeLinker: hoisted` those dependencies are what make a row
	// resolvable, so an extra (or a missing) one is a broken install.
	const dependencies = pack.dependencies ?? {};
	const declared = Object.keys(dependencies).sort();
	const expectedComponents = list.map((component) => component.name).sort();
	if (declared.join("|") !== expectedComponents.join("|")) {
		errors.push(`pack: dependencies must be exactly its five components (got ${declared.join(", ") || "none"})`);
	}
	for (const component of list) {
		const range = dependencies[component.name];
		if (range !== undefined && !range.includes(component.version)) {
			errors.push(`pack: dependency range ${range} for ${component.name} does not include ${component.version}`);
		}
	}
	if (!fs.existsSync(path.join(PLUGIN, "LICENSE"))) errors.push("pack: LICENSE is missing");

	const rows = fs.readFileSync(path.join(PLUGIN, "cordis.patch.yml"), "utf8");
	for (const component of list) {
		if (!rows.includes(component.name)) errors.push(`cordis.patch.yml declares no row for ${component.name}`);
	}
}

/**
 * Collect every regular file below a directory, as sorted forward-slash
 * relative paths.
 * @param root - directory to walk.
 * @returns relative paths, sorted so two builds of one tree agree byte for byte.
 */
function listFiles(root) {
	const found = [];
	/** @param dir - absolute directory. @param prefix - relative prefix. */
	function walk(dir, prefix) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(absolute, relative);
			else if (entry.isFile()) found.push(relative);
		}
	}
	walk(root, "");
	return found;
}

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value;
	}
	return table;
})();

/**
 * CRC-32 of one buffer, as the ZIP format requires.
 * @param buffer - file contents.
 * @returns the unsigned checksum.
 */
function crc32(buffer) {
	let crc = -1;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

/**
 * Fixed MS-DOS time/date stamp (2026-01-01 00:00), so rebuilding the same tree
 * produces the same archive: hashes in a release note stay meaningful.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * Write a ZIP archive without any dependency or shell-out.
 *
 * `Compress-Archive` stores entry names with backslashes on Windows, which
 * unpacks into literal backslash filenames on Linux and macOS — a release
 * archive must use forward slashes everywhere, so the container is written here
 * instead. Deflate + one fixed timestamp keeps the output small and repeatable.
 *
 * @param sourceDir - directory whose CONTENTS become the archive root.
 * @param outFile - archive path to write.
 * @returns the archive size in bytes.
 */
function writeZip(sourceDir, outFile) {
	const { deflateRawSync } = require("node:zlib");
	const entries = [];
	const localChunks = [];
	let offset = 0;
	for (const relative of listFiles(sourceDir)) {
		const data = fs.readFileSync(path.join(sourceDir, relative));
		const name = Buffer.from(relative, "utf8");
		const body = deflateRawSync(data, { level: 9 });
		const checksum = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 entry names
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		localChunks.push(local, name, body);

		entries.push({ name, checksum, compressed: body.length, size: data.length, offset });
		offset += local.length + name.length + body.length;
	}

	const centralChunks = [];
	for (const entry of entries) {
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(entry.checksum, 16);
		central.writeUInt32LE(entry.compressed, 20);
		central.writeUInt32LE(entry.size, 24);
		central.writeUInt16LE(entry.name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(entry.offset, 42);
		centralChunks.push(central, entry.name);
	}
	const centralBuffer = Buffer.concat(centralChunks);

	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuffer.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	const archive = Buffer.concat([...localChunks, centralBuffer, end]);
	fs.writeFileSync(outFile, archive);
	return archive.length;
}

function main() {
	const checkOnly = process.argv.includes("--check");
	const list = components();
	syncComponents(list);
	for (const component of list) {
		auditComponent(component.name, path.join(PLUGIN, "node_modules", nodeModulesPath(component.name)));
		console.log(`  synced ${component.name}@${component.version}`);
	}
	auditPack(list);

	console.log(`\naudit: ${errors.length === 0 ? "clean" : `${errors.length} problem(s)`}`);
	for (const error of errors) console.error(`  ✗ ${error}`);
	if (errors.length > 0) process.exit(1);

	const pack = packManifest();
	if (checkOnly) {
		console.log(`\nchecked ${pack.name}@${pack.version} (no archive written)`);
		return;
	}
	fs.mkdirSync(DIST, { recursive: true });
	const archive = path.join(DIST, `dsh-session-toolkit-${pack.version}.zip`);
	fs.rmSync(archive, { force: true });
	const size = writeZip(PLUGIN, archive);
	console.log(`\nwrote ${path.relative(ROOT, archive)} (${(size / 1024).toFixed(1)} KB)`);
}

main();
