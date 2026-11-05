/**
 * One-shot generator for the merged `dsh-session-toolkit` bundle.
 *
 * The three shipped plugins are merged without rewriting their logic:
 * - Host: each original host module is copied verbatim into `lib/features/` and
 *   mounted from one plugin row, with per-feature sub-config and a mount log.
 * - Client: each original browser half is wrapped in its own closure inside one
 *   client module, so every feature keeps its own identifiers, stores, locale
 *   namespace, CSS tag and slot registrations without collisions.
 */
const fs = require("node:fs");
const path = require("node:path");

const WORKSPACE = "C:/Users/G1enn/Documents/deepseek-harness/default-workspace";
const OUT = path.join(WORKSPACE, "session-toolkit", "plugin");
const FEATURES = path.join(OUT, "lib", "features");

const SOURCES = {
	archivedDelete: {
		host: path.join(WORKSPACE, "archived-session-delete", "plugin", "lib", "host.js"),
		client: path.join(WORKSPACE, "archived-session-delete", "plugin", "lib", "client.js"),
		clientId: "dsh-archived-session-delete"
	},
	workspaceMove: {
		host: path.join(WORKSPACE, "session-workspace-move", "plugin", "lib", "host-v103.js"),
		client: path.join(WORKSPACE, "session-workspace-move", "plugin", "lib", "client.js"),
		clientId: "dsh-session-workspace-move"
	},
	unsentGuard: {
		host: path.join(WORKSPACE, "unsent-content-guard", "plugin", "lib", "host-v106.js"),
		client: path.join(WORKSPACE, "unsent-content-guard", "plugin", "client.js"),
		clientId: "dsh-unsent-content-guard"
	}
};

function ensureDir(directory) {
	fs.mkdirSync(directory, { recursive: true });
}

/** Extract the factory body of one browser bundle (everything after `factory: (require) => {`). */
function clientBody(file) {
	const text = fs.readFileSync(file, "utf8");
	const marker = "factory: (require) => {";
	const start = text.indexOf(marker);
	if (start < 0) throw new Error(`factory marker missing in ${file}`);
	const bodyStart = start + marker.length;
	const endMarker = "return module.exports;";
	const end = text.lastIndexOf(endMarker);
	if (end < 0 || end < bodyStart) throw new Error(`return marker missing in ${file}`);
	const body = text.slice(bodyStart, end + endMarker.length).replace(/^\s*\n/, "").replace(/\s+$/u, "");
	return body;
}

/** Write the three verbatim host modules, wrapped with the mount header comment. */
function writeFeatureHosts() {
	const mapping = {
		archivedDelete: "archived-delete/host.js",
		workspaceMove: "workspace-move/host.js",
		unsentGuard: "unsent-guard/host.js"
	};
	for (const [feature, relative] of Object.entries(mapping)) {
		const target = path.join(FEATURES, relative);
		ensureDir(path.dirname(target));
		const source = fs.readFileSync(SOURCES[feature].host, "utf8");
		const header = `/* Verbatim host half of the merged feature "${feature}".\n * Originally shipped as its own plugin; mounted by ../../host.js. */\n`;
		fs.writeFileSync(target, header + source, "utf8");
	}
}

function writeMergedClient() {
	const order = ["archivedDelete", "workspaceMove", "unsentGuard"];
	const variable = { archivedDelete: "archivedDeleteClient", workspaceMove: "workspaceMoveClient", unsentGuard: "unsentGuardClient" };
	let blocks = "";
	for (const feature of order) {
		const body = clientBody(SOURCES[feature].client);
		const indented = body.split("\n").map((line) => (line === "" ? "" : `\t\t${line}`)).join("\n");
		blocks += `\t\t/* ===== ${feature} (browser half, verbatim in its own closure) ===== */\n`;
		blocks += `\t\tconst ${variable[feature]} = (() => {\n${indented}\n\t\t})();\n\n`;
	}
	const client = `window.__ModuleLoader__.load({
	id: "dsh-session-toolkit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/* The merged browser module: each feature keeps its own factory-scoped
		 * identifiers, stores, locale namespace, CSS tag and slot registrations. */
${blocks}\t\tconst features = [
			["archivedDelete", ${variable.archivedDelete}],
			["workspaceMove", ${variable.workspaceMove}],
			["unsentGuard", ${variable.unsentGuard}]
		];
		const inject = [...new Set(features.flatMap(([, feature]) => (Array.isArray(feature.inject) ? feature.inject : [])))];
		function apply(ctx) {
			for (const [feature, browserPlugin] of features) {
				try {
					browserPlugin.apply(ctx);
				} catch (error) {
					console.error(\`[session-toolkit] browser feature "\${feature}" failed to mount\`, error);
				}
			}
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
`;
	fs.writeFileSync(path.join(OUT, "lib", "client.js"), client, "utf8");
}

function writeMergedHost() {
	const host = `/**
 * Merged host half of the Session Toolkit bundle.
 *
 * One plugin row mounts all three independently developed features:
 * - archivedDelete: delete an archived Session (log, projection cache,
 *   workspace accounting, archive mark);
 * - workspaceMove: move a stored Session to another Workspace (header rewrite,
 *   log relocation, registry accounting, backup/rollback/queue);
 * - unsentGuard: back up unsent composer text and images, delete them on a
 *   successful send, restore them on switch/crash/restart.
 *
 * Each feature's original host module is kept verbatim under \`lib/features/\`
 * and only mounted here; per-feature sub-config comes from this row's
 * \`config.archivedDelete\` / \`config.workspaceMove\` / \`config.unsentGuard\`.
 * A mount failure in one feature is logged and does not stop the others.
 *
 * @module dsh-session-toolkit
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { apply as applyArchivedDelete } from "./features/archived-delete/host.js";
import { apply as applyWorkspaceMove } from "./features/workspace-move/host.js";
import { apply as applyUnsentGuard } from "./features/unsent-guard/host.js";

/** Stable Cordis plugin name. */
export const name = "session-toolkit";

/** Every feature reaches the Fetch carrier through \`connection\`; other services are resolved lazily per request. */
export const inject = ["connection"];

/** \`$DSH_HOME/session-toolkit\`: mount diagnostics for the merged bundle. */
function dataDir() {
	const configured = (process.env.DSH_HOME ?? "").trim();
	return join(configured.length > 0 ? resolve(configured) : join(homedir(), ".dsh"), "session-toolkit");
}

/**
 * Record one mount result so verification can prove every feature attached.
 * @param feature - feature key.
 * @param ok - whether its apply completed.
 * @param error - failure detail, when any.
 */
function recordMount(feature, ok, error) {
	try {
		mkdirSync(dataDir(), { recursive: true });
		appendFileSync(join(dataDir(), "mount.log"), JSON.stringify({
			at: new Date().toISOString(),
			feature,
			ok,
			error: error === undefined ? null : String(error?.message ?? error)
		}) + "\\n");
	} catch {
		/* diagnostics are best effort */
	}
}

/**
 * Mount the three merged features.
 * @param ctx - Host plugin context.
 * @param config - raw row config with optional per-feature sections.
 */
export function apply(ctx, config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const features = [
		["archivedDelete", applyArchivedDelete, raw.archivedDelete],
		["workspaceMove", applyWorkspaceMove, raw.workspaceMove],
		["unsentGuard", applyUnsentGuard, raw.unsentGuard]
	];
	for (const [feature, mount, section] of features) {
		try {
			mount(ctx, section !== null && typeof section === "object" ? section : {});
			recordMount(feature, true);
		} catch (error) {
			recordMount(feature, false, error);
			ctx.logger?.warn?.(\`session-toolkit: feature "\${feature}" failed to mount: \${String(error)}\`);
		}
	}
}
`;
	fs.writeFileSync(path.join(OUT, "lib", "host.js"), host, "utf8");
}

function writeManifest() {
	const manifest = {
		name: "dsh-session-toolkit",
		version: "1.0.0",
		private: true,
		description: "One merged Session Toolkit: delete archived Sessions, move Sessions to another Workspace, and back up unsent composer text/images.",
		type: "module",
		main: "lib/host.js",
		exports: {
			".": "./lib/host.js",
			"./client": "./lib/client.js",
			"./cordis.patch.yml": "./cordis.patch.yml",
			"./locale/*.json": "./locale/*.json",
			"./icon": "./icon.svg",
			"./package.json": "./package.json"
		},
		files: [
			"lib/host.js",
			"lib/client.js",
			"lib/features/*.js",
			"lib/features/**/*.js",
			"cordis.patch.yml",
			"locale/*.json",
			"icon.svg"
		],
		dsh: {
			bundle: { patch: "./cordis.patch.yml" },
			client: {
				platform: "web",
				immediately: true,
				inject: [
					"@deepseek-ai/dsh-api-workspace-controller",
					"@deepseek-ai/dsh-client-locale",
					"@deepseek-ai/dsh-client-ui-workspace",
					"@deepseek-ai/dsh-client-ui-conversation"
				]
			}
		}
	};
	fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function writePatch() {
	const patch = `# Bundle patch: mount the merged Session Toolkit row.
#
# One row mounts three features. Optional per-feature config sections keep the
# original options of each feature (see README):
#   archivedDelete: {}                      # no options today
#   workspaceMove:                          # dsh-session-workspace-move options
#     dataDir, backupKeep, retrySeconds, selfTest
#   unsentGuard:                            # dsh-unsent-content-guard options
#     root, enabled, retainDays, selfTest, debugEvents, restoreOnOpen, restoreMaxAgeHours
- insert:
    - id: session-toolkit
      name: 'dsh-session-toolkit'
      config: {}
`;
	fs.writeFileSync(path.join(OUT, "cordis.patch.yml"), patch, "utf8");
}

ensureDir(FEATURES);
ensureDir(path.join(OUT, "locale"));
writeFeatureHosts();
writeMergedClient();
writeMergedHost();
writeManifest();
writePatch();
console.log("generated:", OUT);
for (const file of ["lib/host.js", "lib/client.js", "lib/features/archived-delete/host.js", "lib/features/workspace-move/host.js", "lib/features/unsent-guard/host.js", "package.json", "cordis.patch.yml"]) {
	const stat = fs.statSync(path.join(OUT, file));
	console.log(`${file}  ${stat.size}`);
}
