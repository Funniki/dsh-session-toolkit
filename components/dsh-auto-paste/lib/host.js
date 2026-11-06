/**
 * Host half of 「长文本转附件」 (anonymous paste store).
 *
 * A large paste into the composer is intercepted by the client half and handed
 * here over a Host route: this module writes it to
 * `<workspace>/pastes/<slug>.<md|txt>` and answers with the reference the
 * composer shows as an atomic chip. The same write is exposed as the
 * `save_paste` tool, so the model can persist a big block of text instead of
 * echoing it back into the conversation.
 *
 * ZERO PACKAGE DEPENDENCIES — this file imports Node builtins only. The routes
 * ride the shared `connection` carrier, the tool is registered through the
 * `tools` service, and preferences live in one small JSON file under
 * `$DSH_HOME`. Nothing here imports a Harness package on purpose: an earlier
 * build of this component pulled `@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/dsh-typert-protocol` and `@deepseek-ai/schemastery` into the
 * pack, and the second copy of the Harness core that produced is what broke the
 * Plugin host (two module instances, two scheduler symbols, dead tool calls).
 *
 * @module dsh-auto-paste
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, relative, resolve } from "node:path";

/** Stable Cordis plugin name (matches the bundle row id). */
export const name = "dsh-auto-paste";

/** Services this plugin needs before it may activate. */
export const inject = ["connection", "tools", "sessions"];

/** Route pathnames, served by the authenticated Fetch carrier. */
const SAVE_PATH = "/api/auto-paste.save";
const CONFIG_PATH = "/api/auto-paste.config";
const THRESHOLD_PATH = "/api/auto-paste.threshold";

/** Default trigger threshold: pastes at least this many characters are saved. */
export const MIN_CHARS_DEFAULT = 500;

/** Default per-paste byte ceiling. */
export const MAX_PASTE_BYTES = 1024 * 1024;

/** Hard ceiling a deployment may raise `maxBytes` to. */
export const MAX_PASTE_BYTES_CAP = 64 * 1024 * 1024;

/** Longest accepted `label` argument on the tool. */
export const MAX_LABEL_CHARS = 32;

/** Characters a `label` may contain. */
const LABEL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/** Collision-rename attempts before a paste is refused. */
export const MAX_COLLISION_ATTEMPTS = 1000;

/** User-preference file, relative to `$DSH_HOME/auto-paste`. */
const USER_CONFIG_NAME = "user-config.json";

/** Directory name under `$DSH_HOME` owned by this plugin. */
const DATA_DIR_NAME = "auto-paste";

// ---------------------------------------------------------------------------
// preferences
// ---------------------------------------------------------------------------

/** @returns the resolved harness home (`$DSH_HOME` else `~/.dsh`). */
function dshHome() {
	const configured = (process.env.DSH_HOME ?? "").trim();
	return configured.length > 0 ? resolve(configured) : join(homedir(), ".dsh");
}

/** @returns this plugin's own directory under the harness home. */
function dataDir() {
	return join(dshHome(), DATA_DIR_NAME);
}

/** @returns the absolute path of the user-preference file. */
function userConfigPath() {
	return join(dataDir(), USER_CONFIG_NAME);
}

/**
 * Unwrap a live config box.
 *
 * A loader row config is a plain object here, but a volatile config arrives as a
 * box with `get()`. Reading the box rather than the number is what makes a value
 * saved by the Settings row visible without a restart, so the unwrap stays.
 *
 * @param raw - configured value or box.
 * @returns the current value.
 */
export function readLiveValue(raw) {
	if (raw !== null && typeof raw === "object" && typeof raw.get === "function") return raw.get();
	return raw;
}

/**
 * Validate one configured `minChars`.
 * @param raw - candidate value.
 * @returns the accepted positive integer.
 * @throws when the value is not a positive integer.
 */
export function resolveMinChars(raw) {
	if (raw === undefined) return MIN_CHARS_DEFAULT;
	if (typeof raw !== "number" || !Number.isInteger(raw)) {
		throw new Error(`minChars must be an integer (got ${JSON.stringify(raw)})`);
	}
	if (raw <= 0) throw new Error(`minChars must be positive (got ${raw})`);
	return raw;
}

/**
 * Validate one configured `maxBytes`.
 * @param raw - candidate value.
 * @returns the accepted byte ceiling.
 * @throws when the value is not a positive integer within the hard ceiling.
 */
export function resolveMaxBytes(raw) {
	if (raw === undefined) return MAX_PASTE_BYTES;
	if (typeof raw !== "number" || !Number.isInteger(raw)) {
		throw new Error(`maxBytes must be an integer (got ${JSON.stringify(raw)})`);
	}
	if (raw <= 0) throw new Error(`maxBytes must be positive (got ${raw})`);
	if (raw > MAX_PASTE_BYTES_CAP) {
		throw new Error(`maxBytes ${raw} exceeds the ${MAX_PASTE_BYTES_CAP}-byte hard ceiling`);
	}
	return raw;
}

/**
 * Pick the threshold that is actually in force.
 * @param stored - the user's saved value, when one is stored.
 * @param deployment - the value configured on the bundle row.
 * @returns the effective threshold and the layer it came from.
 */
export function effectiveMinChars(stored, deployment) {
	const usable = (value) => typeof value === "number" && Number.isInteger(value) && value > 0;
	if (usable(stored)) return { minChars: stored, source: "user" };
	return { minChars: usable(deployment) ? deployment : MIN_CHARS_DEFAULT, source: "deployment" };
}

/**
 * Read the user's saved threshold.
 *
 * A missing or unreadable file is not an error: the deployment default is a
 * complete configuration, and this plugin must keep working when its own state
 * directory is gone.
 *
 * @returns the saved positive integer, or undefined.
 */
async function readStoredMinChars() {
	let text;
	try {
		text = await readFile(userConfigPath(), "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(text);
		const value = parsed?.minChars;
		return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Store (or clear) the user's threshold.
 *
 * Written through a temporary file and a rename so a crash mid-write cannot
 * leave a truncated preference behind; `null` stores an empty object, which
 * reads back as "no preference" and restores the deployment default.
 *
 * @param value - positive integer, or null to clear.
 */
async function writeStoredMinChars(value) {
	const dir = dataDir();
	await mkdir(dir, { recursive: true });
	const target = userConfigPath();
	const temporary = `${target}.tmp`;
	const body = `${JSON.stringify(value === null ? {} : { minChars: value }, null, 2)}\n`;
	await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
	await rename(temporary, target);
}

// ---------------------------------------------------------------------------
// paste content
// ---------------------------------------------------------------------------

/**
 * Validate one tool `label`.
 * @param raw - candidate label.
 * @returns the accepted label.
 * @throws when the label is empty, too long, or outside [A-Za-z0-9_-].
 */
export function sanitizeLabel(raw) {
	if (typeof raw !== "string" || raw.length === 0) {
		throw new Error(`label must be a non-empty ASCII string (got ${JSON.stringify(raw)})`);
	}
	if (raw.length > MAX_LABEL_CHARS) {
		throw new Error(
			`label too long: ${raw.length} chars exceeds the ${MAX_LABEL_CHARS}-char limit (got ${JSON.stringify(raw)})`
		);
	}
	if (!LABEL_PATTERN.test(raw)) {
		throw new Error(`label may only contain [A-Za-z0-9_-] (got ${JSON.stringify(raw)})`);
	}
	return raw;
}

/**
 * Does this text read as Markdown? Only the unambiguous constructs count, so a
 * plain prose dump stays `.txt` and a note with headings or code fences lands as
 * `.md` — the extension decides which viewer the chip opens.
 *
 * @param text - pasted text.
 * @returns whether the text should be stored as Markdown.
 */
export function looksMarkdown(text) {
	if (typeof text !== "string" || text.length === 0) return false;
	if (/^#{1,6}\s+\S/mu.test(text)) return true;
	if (/```/u.test(text)) return true;
	if (/^\s*[-*+]\s+\S/mu.test(text)) return true;
	if (/^\s*\d+\.\s+\S/mu.test(text)) return true;
	if (/^\s*>\s+\S/mu.test(text)) return true;
	if (/\[[^\]]+\]\([^)\s]+\)/u.test(text)) return true;
	if (/^\s*\|.+\|\s*$/mu.test(text)) return true;
	return false;
}

/**
 * Derive a filesystem-safe slug from the first non-empty line.
 * @param text - pasted text.
 * @returns a short slug, or `paste` when nothing usable is left.
 */
export function slugOf(text) {
	const firstLine =
		String(text ?? "")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? "";
	const cleaned = firstLine
		.replace(/^#{1,6}\s+/u, "")
		.replace(/^[>*+-]\s+/u, "")
		.replace(/[`*_~[\]#]/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	const words = cleaned
		.slice(0, 24)
		.replace(/[^A-Za-z0-9\u4e00-\u9fff ]+/gu, "")
		.trim()
		.replace(/\s+/gu, "-");
	return words.length > 0 ? words : "paste";
}

/**
 * Build the file name for one paste.
 * @param text - pasted text.
 * @param ext - `md` or `txt`.
 * @param label - optional tool label appended to the slug.
 * @returns the file name (no directory).
 */
export function pasteFilename(text, ext = "txt", label) {
	const base = slugOf(text);
	return label === undefined ? `${base}.${ext}` : `${base}-${sanitizeLabel(label)}.${ext}`;
}

/**
 * Refuse a paste that exceeds the byte ceiling, before anything is written.
 * @param text - pasted text.
 * @param maxBytes - ceiling in force for this call.
 * @throws when the text is larger than the ceiling.
 */
export function assertPasteSize(text, maxBytes = MAX_PASTE_BYTES) {
	const bytes = Buffer.byteLength(text, "utf8");
	if (bytes > maxBytes) {
		throw new Error(`paste too large: ${bytes} bytes exceeds the ${maxBytes}-byte limit; refusing to write`);
	}
}

/**
 * The tool-facing projection: the absolute path stays out of the model's
 * context, the workspace-relative one is what a reply can reference.
 * @param result - the internal save result.
 * @returns path, bytes and chars only.
 */
export function publicPasteRef(result) {
	return { path: result.path, bytes: result.bytes, chars: result.chars };
}

/**
 * The wire projection: the client needs `absolutePath` to nothing today, but the
 * shape stays stable so the browser half never has to be re-released with it.
 * @param result - the internal save result.
 * @returns the public fields plus the absolute path.
 */
export function wirePasteRef(result) {
	return { ...publicPasteRef(result), absolutePath: result.absolutePath };
}

/**
 * Write one pasted chunk into `<workspace>/pastes/`.
 *
 * The file is created with `wx` so an existing file is never overwritten;
 * a name collision walks `<slug>-1`, `<slug>-2`, … instead. Directory and file
 * modes are the same 0o700/0o600 the plugin used before the rewrite.
 *
 * @param workspaceDir - absolute workspace directory.
 * @param text - pasted text, written verbatim.
 * @param now - reserved (kept for the previous signature: names come from the text).
 * @param maxBytes - ceiling in force for this call.
 * @param label - optional tool label.
 * @returns the workspace-relative path, absolute path, bytes and chars.
 */
export async function savePasteTo(workspaceDir, text, now = new Date(), maxBytes = MAX_PASTE_BYTES, label) {
	assertPasteSize(text, maxBytes);
	const ext = looksMarkdown(text) ? "md" : "txt";
	const rel = join("pastes", pasteFilename(text, ext, label));
	const base = join(workspaceDir, rel);
	await mkdir(dirname(base), { recursive: true, mode: 0o700 });
	let target;
	for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
		const candidate =
			attempt === 0
				? base
				: join(workspaceDir, "pastes", `${basename(rel, `.${ext}`)}-${attempt}.${ext}`);
		try {
			await writeFile(candidate, text, { flag: "wx", mode: 0o600 });
			target = candidate;
			break;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
	}
	if (target === undefined) {
		throw new Error(
			`paste: gave up after ${MAX_COLLISION_ATTEMPTS} name collisions for ${rel}; remove or rename the squatters under pastes/ and retry`
		);
	}
	return {
		path: relative(workspaceDir, target).split("\\").join("/"),
		absolutePath: target,
		bytes: Buffer.byteLength(text, "utf8"),
		chars: text.length
	};
}

// ---------------------------------------------------------------------------
// workspace resolution
// ---------------------------------------------------------------------------

/**
 * @param ctx - Host plugin context.
 * @returns the registered workspaces, or undefined when the registry is absent.
 */
function registeredWorkspaces(ctx) {
	const registry = ctx.get("workspaceRegistry");
	return registry?.list();
}

/**
 * Compare two directories the way the platform does.
 * @param dir - directory to normalize.
 * @returns a comparable key.
 */
function workspaceKey(dir) {
	const cleaned = normalize(dir).replace(/[\\/]+$/u, "").replace(/\\/gu, "/");
	return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

/**
 * Is this directory one of the registered workspaces?
 * @param dir - candidate directory.
 * @param workspaces - the registry listing.
 * @returns whether the directory is registered.
 */
export function isRegisteredWorkspace(dir, workspaces) {
	const target = workspaceKey(dir);
	return workspaces.some((workspace) => workspaceKey(workspace.path) === target);
}

/**
 * Build the refusal raised when the target workspace cannot be decided.
 *
 * A wrong guess writes the paste into an unrelated project, which is worse than
 * refusing, so the message lists what was available and what would fix it.
 *
 * @param reason - why the resolution failed.
 * @param workspaces - the registry listing.
 * @param sessionId - the session id that was available, when any.
 * @returns the error to throw.
 */
function workspaceRefusal(reason, workspaces, sessionId) {
	const who = sessionId === undefined ? "this call carried no session id" : `session "${sessionId}"`;
	const list = workspaces
		.map((workspace) => {
			const count = workspace.sessionIds.length;
			return `  - ${basename(workspace.path)}  (${count} session${count === 1 ? "" : "s"})`;
		})
		.join("\n");
	return new Error(
		`[dsh-auto-paste] refusing to save the paste: ${reason} (${who}).\n` +
			`Registered workspaces (${workspaces.length}):\n${list}\n` +
			"How to fix: paste from a session that belongs to one of those workspaces (a session is registered to the workspace it was started in), or start a session for the workspace you want and paste again. Nothing was written."
	);
}

/**
 * Decide which workspace directory a paste belongs to.
 * @param ctx - Host plugin context.
 * @param sessionId - the session that raised the paste, when known.
 * @param cwd - the session's directory, when known.
 * @returns the workspace directory, or undefined when no workspace is registered.
 * @throws when the target is ambiguous or the session owns no workspace.
 */
export function resolveWorkspaceDir(ctx, sessionId, cwd) {
	const workspaces = registeredWorkspaces(ctx);
	if (workspaces === undefined || workspaces.length === 0) return undefined;
	if (cwd !== undefined && isRegisteredWorkspace(cwd, workspaces)) return cwd;
	if (sessionId !== undefined) {
		const owned = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
		if (owned !== undefined) return owned.path;
		throw workspaceRefusal(
			"this session is not registered to any workspace, and guessing one could write the paste into the wrong project",
			workspaces,
			sessionId
		);
	}
	if (workspaces.length > 1) {
		throw workspaceRefusal("no session id was available, so the target workspace is ambiguous", workspaces);
	}
	return workspaces[0]?.path;
}

// ---------------------------------------------------------------------------
// route responses
// ---------------------------------------------------------------------------

/**
 * Answer one request.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 * @returns the Fetch response.
 */
function json(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** @returns one error's message text. */
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Read a JSON request body.
 * @param request - the buffered request.
 * @returns the parsed body, or undefined when it is not JSON.
 */
async function readJson(request) {
	try {
		const parsed = await request.json();
		return parsed !== null && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The deployment defaults, as configured on the bundle row right now.
 * @param config - raw row config.
 * @returns validated `minChars` and `maxBytes`.
 */
function deploymentConfig(config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	let minChars = MIN_CHARS_DEFAULT;
	let maxBytes = MAX_PASTE_BYTES;
	try {
		minChars = resolveMinChars(readLiveValue(raw.minChars));
	} catch (error) {
		console.error(
			`[dsh-auto-paste] invalid minChars in config — falling back to ${MIN_CHARS_DEFAULT} chars:`,
			error
		);
	}
	try {
		maxBytes = resolveMaxBytes(readLiveValue(raw.maxBytes));
	} catch (error) {
		console.error(
			`[dsh-auto-paste] invalid maxBytes in config — falling back to ${MAX_PASTE_BYTES} bytes:`,
			error
		);
	}
	return { minChars, maxBytes };
}

/**
 * Build the config payload the browser half reads (and re-reads after a write).
 * @param config - raw row config.
 * @returns the effective settings together with their layer.
 */
async function configPayload(config) {
	const deployment = deploymentConfig(config);
	const stored = await readStoredMinChars();
	const { minChars, source } = effectiveMinChars(stored, deployment.minChars);
	return {
		minChars,
		maxBytes: deployment.maxBytes,
		minCharsSource: source,
		deploymentMinChars: deployment.minChars,
		canConfigure: true
	};
}

/**
 * Answer one save request.
 * @param ctx - Host plugin context.
 * @param config - raw row config.
 * @param request - the buffered request.
 * @returns the JSON response.
 */
async function saveResponse(ctx, config, request) {
	const payload = await readJson(request);
	if (payload === undefined) return json(400, { error: "bad-request", message: "request body must be JSON" });
	const text = payload.text;
	if (typeof text !== "string") return json(400, { error: "bad-request", message: "text must be a string" });
	const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
	if (sessionId === undefined) {
		return json(400, { error: "bad-request", message: "sessionId must be a string" });
	}
	const sessions = ctx.get("sessions");
	const sessionCwd = sessions?.get?.(sessionId)?.header?.cwd;
	let dir;
	try {
		dir = resolveWorkspaceDir(ctx, sessionId, sessionCwd);
	} catch (error) {
		return json(409, { error: "no-workspace", message: errorMessage(error) });
	}
	if (dir === undefined) return json(409, { error: "no-workspace", message: "no workspace available to save the paste into" });
	const { maxBytes } = deploymentConfig(config);
	try {
		return json(200, wirePasteRef(await savePasteTo(dir, text, new Date(), maxBytes)));
	} catch (error) {
		ctx.logger?.warn?.(`auto-paste: saving a ${text.length}-char paste failed: ${errorMessage(error)}`);
		return json(500, { error: "save-failed", message: errorMessage(error) });
	}
}

/**
 * Answer one threshold write.
 * @param config - raw row config.
 * @param request - the buffered request.
 * @returns the JSON response with the new effective settings.
 */
async function thresholdResponse(config, request) {
	const payload = await readJson(request);
	if (payload === undefined) return json(400, { error: "bad-request", message: "request body must be JSON" });
	const value = payload.value;
	if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
		return json(400, { error: "bad-request", message: "value must be a positive integer or null" });
	}
	try {
		await writeStoredMinChars(value);
	} catch (error) {
		return json(500, { error: "write-failed", message: `could not store the preference: ${errorMessage(error)}` });
	}
	return json(200, await configPayload(config));
}

// ---------------------------------------------------------------------------
// tool
// ---------------------------------------------------------------------------

/**
 * The `save_paste` tool definition.
 *
 * The JSON Schemas are the exact projection the previous build produced through
 * `defineTool` — written out literally here so the tool needs no package. The
 * argument walk is the part `defineTool` used to do for us.
 *
 * @param ctx - Host plugin context.
 * @param config - raw row config.
 * @returns a registry-ready tool definition.
 */
function savePasteTool(ctx, config) {
	const { minChars } = deploymentConfig(config);
	return {
		name: "save_paste",
		description:
			`Persist a large pasted text chunk to a file under pastes/ in the current session workspace ` +
			`(saved as .md when the text looks like Markdown, otherwise .txt), and return the workspace-relative ` +
			`path to reference in the reply. Use this whenever the user pastes a big block of text (roughly ` +
			`${minChars}+ characters): save it, then work against the file instead of echoing the raw text.`,
		parameters: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "The full pasted text chunk to persist verbatim."
				},
				label: {
					type: "string",
					description:
						"Optional short label appended to the content-derived filename: pastes/<slug>-<label>.<ext>. ASCII [A-Za-z0-9_-], max 32 chars; an invalid label fails the call."
				}
			},
			required: ["text"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: { type: "string", description: "Workspace-relative file path (pastes/<slug>.<md|txt>)." },
					bytes: { type: "integer", description: "UTF-8 bytes written." },
					chars: { type: "integer", description: "Length in UTF-16 code units (an emoji counts as 2)." }
				},
				required: ["path", "bytes", "chars"]
			},
			render: (_args, value) => [
				{
					type: "text",
					text: `Saved paste to ${value.path} (${value.bytes} bytes). Reference this file path in your reply.`
				}
			]
		},
		// The tool call executes in the calling agent's session; its header cwd is
		// the session workspace directory (the same source the shell tool uses).
		async execute(args, exec) {
			if (args === null || typeof args !== "object") throw new Error("save_paste: arguments must be an object");
			if (typeof args.text !== "string") throw new Error("save_paste: text must be a string");
			const headerCwd = exec.agent?.session?.header?.cwd;
			const dir =
				typeof headerCwd === "string" && headerCwd.length > 0 ? headerCwd : resolveWorkspaceDir(ctx);
			if (dir === undefined) throw new Error("save_paste: cannot resolve the session workspace directory");
			const registered = registeredWorkspaces(ctx) ?? [];
			if (!isRegisteredWorkspace(dir, registered)) {
				throw new Error(`save_paste: refusing to write outside a registered workspace (${basename(dir)})`);
			}
			const { maxBytes } = deploymentConfig(config);
			return publicPasteRef(await savePasteTo(dir, args.text, new Date(), maxBytes, args.label));
		}
	};
}

// ---------------------------------------------------------------------------
// activation
// ---------------------------------------------------------------------------

/**
 * Mount the routes and the tool.
 * @param ctx - Host plugin context.
 * @param config - raw bundle row config (`minChars`, `maxBytes`).
 */
export function apply(ctx, config) {
	const connection = ctx.get("connection");
	if (connection !== undefined) {
		ctx.effect(
			() =>
				connection.fetch.register({
					path: SAVE_PATH,
					methods: ["POST"],
					requestBody: "buffered",
					fetch: (request) => saveResponse(ctx, config, request)
				}),
			"auto-paste: save route"
		);
		ctx.effect(
			() =>
				connection.fetch.register({
					path: CONFIG_PATH,
					methods: ["POST"],
					requestBody: "buffered",
					fetch: () => configPayload(config).then((payload) => json(200, payload))
				}),
			"auto-paste: config route"
		);
		ctx.effect(
			() =>
				connection.fetch.register({
					path: THRESHOLD_PATH,
					methods: ["POST"],
					requestBody: "buffered",
					fetch: (request) => thresholdResponse(config, request)
				}),
			"auto-paste: threshold route"
		);
	} else {
		ctx.logger?.warn?.("auto-paste: the connection carrier is unavailable — the composer half cannot save pastes");
	}

	const tools = ctx.get("tools");
	if (tools !== undefined && typeof tools.register === "function") {
		ctx.effect(() => tools.register(savePasteTool(ctx, config)), "auto-paste: save_paste tool");
	} else {
		ctx.logger?.warn?.("auto-paste: the tools service is unavailable — the save_paste tool is not registered");
	}

	const deployment = deploymentConfig(config);
	console.log(
		`[dsh-auto-paste] host ready — routes ${SAVE_PATH}, ${CONFIG_PATH}, ${THRESHOLD_PATH}; ` +
			`save_paste listed=${ctx.get("tools")?.get?.("save_paste") !== undefined} ` +
			`(minChars=${deployment.minChars}, maxBytes=${deployment.maxBytes})`
	);
}
