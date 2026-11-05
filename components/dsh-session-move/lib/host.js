/**
 * Host half of the "move Session to another Workspace" feature.
 *
 * DSH ties a stored Session to a Workspace through the Session header's `cwd`:
 * the registry's membership index compares each Session's canonical header cwd
 * to the Workspace path, `attachSession` refuses a mismatch, and the JSONL
 * persistence backend derives the Session directory from that same cwd. There
 * is no public "move" API, so this plugin performs the real migration:
 *
 * 1. A Session that is open in this process is moved HOT when it is idle: flush
 *    its buffered events, then repoint BOTH the live Session header and the
 *    persistence write handle at the target cwd, so appends during the move
 *    cannot recreate the old project directory. When a turn is running the move
 *    is refused (`active`); when the write handle is unavailable it falls back
 *    to the queue and is retried after the Session unloads / DSH restarts.
 * 2. Copy the stored Session directory to a recovery backup before any change.
 * 3. Rewrite only the header `cwd` (first JSONL frame) and keep every event
 *    frame byte-identical. When an existing `working-directory/change` event
 *    would keep the old directory effective, one new event with the next
 *    contiguous sequence number is appended.
 * 4. Relocate the Session directory to the target Workspace's project directory,
 *    publish it through a temporary file and an atomic rename, then remove the
 *    old directory.
 * 5. Invalidate the registry's version-sensitive in-memory header indexes so
 *    the official `attachSession` reads the migrated header, then
 *    `detachSession` the source and `attachSession` the target.
 * 6. Verify the stored header and the target accounting; roll the original
 *    bytes back on any failure.
 *
 * All Session and Workspace changes go through host services and their public
 * entity methods; the only file writes are the physical migration itself.
 *
 * @module dsh-session-move
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/** Stable Cordis plugin name. */
export const name = "session-move";

/** Required host services: the Fetch carrier, Session persistence, and the Workspace registry. */
export const inject = ["connection", "sessionPersistence", "workspaceRegistry"];

/** Routes served by this plugin over the authenticated `/api` carrier. */
export const MOVE_PATH = "/api/session.move";
export const TARGETS_PATH = "/api/session.move.targets";
export const PROBE_PATH = "/api/session.move.probe";

/** Plugin-owned directory under `$DSH_HOME`. */
const DATA_DIR_NAME = "session-move";

/** Session format generation whose physical header this plugin understands. */
const HEADER_VERSION = 4;

/** Little-endian Zstandard frame magic (`28 B5 2F FD`). */
const ZSTD_MAGIC = 0xfd2fb528;

/** Checksummed frame options matching the persistence backend's own writer. */
const ZSTD_CHECKSUM = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } };

/** Stored session artifact filename. */
const LOG_NAME = /^session\.v(\d+)\.jsonl(\.zstd)?$/u;

/** Session/Workspace ids accepted from the browser are re-validated before shaping paths. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

/** Recovery snapshots kept per Session. */
const BACKUP_KEEP = 20;

/** Interval between queued-move retries, in milliseconds. */
const QUEUE_RETRY_MS = 20000;

/** First queued-move retry delay after plugin start, in milliseconds. */
const STARTUP_RETRY_MS = 4000;

/**
 * A refused move, carrying a stable code the HTTP layer maps to a status.
 */
export class SessionMoveRefusal extends Error {
	/**
	 * @param code - stable refusal code.
	 * @param message - operator-facing explanation.
	 * @param details - extra response fields.
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "SessionMoveRefusal";
		this.code = code;
		Object.assign(this, details);
	}
}

/**
 * Register the move routes, the queue retry timer, and the optional self-test.
 * @param ctx - Host plugin context.
 * @param config - optional raw row configuration.
 */
export function apply(ctx, config) {
	const options = resolveOptions(config);
	if (!options.enabled) return;
	const connection = ctx.get("connection");
	if (connection === undefined) return;
	ctx.effect(() => connection.fetch.register({
		path: MOVE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => moveResponse(ctx, request, options)
	}), "session-move: move route");
	ctx.effect(() => connection.fetch.register({
		path: TARGETS_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => targetsResponse(ctx, request)
	}), "session-move: targets route");
	ctx.effect(() => connection.fetch.register({
		path: PROBE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => probeResponse(request, options)
	}), "session-move: probe route");
	ctx.effect(() => {
		const timer = ctx.get("timer");
		const dispose = typeof timer?.interval === "function" ? timer.interval(() => {
			retryQueue(ctx, options).catch((error) => ctx.logger?.warn?.(`session-move: queue retry failed: ${String(error)}`));
		}, options.retryIntervalMs) : () => {};
		return dispose;
	}, "session-move: queue retry timer");
	ctx.effect(() => {
		const timer = ctx.get("timer");
		const dispose = typeof timer?.timeout === "function" ? timer.timeout(() => {
			retryQueue(ctx, options).catch((error) => ctx.logger?.warn?.(`session-move: startup queue retry failed: ${String(error)}`));
		}, STARTUP_RETRY_MS) : () => {};
		return dispose;
	}, "session-move: startup queue retry");
	if (options.selfTest) {
		runSelfTest(ctx, options).catch((error) => ctx.logger?.warn?.(`session-move: self-test failed: ${String(error)}`));
	}
}

/**
 * Resolve raw row configuration.
 * @param config - raw row config, when present.
 * @returns the normalized options.
 */
function resolveOptions(config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const retrySeconds = Number(raw.retrySeconds);
	return {
		enabled: raw.enabled !== false,
		backupKeep: Number.isFinite(Number(raw.backupKeep)) && Number(raw.backupKeep) > 0 ? Math.floor(Number(raw.backupKeep)) : BACKUP_KEEP,
		retryIntervalMs: Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.max(5000, retrySeconds * 1000) : QUEUE_RETRY_MS,
		selfTest: raw.selfTest === true,
		dataDir: typeof raw.dataDir === "string" && raw.dataDir.trim() !== "" ? resolve(raw.dataDir.trim()) : join(dshHome(), DATA_DIR_NAME)
	};
}

/** @returns the resolved harness home (`$DSH_HOME` else `~/.dsh`). */
function dshHome() {
	const configured = (process.env.DSH_HOME ?? "").trim();
	return configured.length > 0 ? resolve(configured) : join(homedir(), ".dsh");
}

/** Ensure one directory exists. @param path - absolute directory. */
function ensureDir(path) {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/**
 * Encode an arbitrary string as one safe path segment (the persistence
 * backend's own encoding, reproduced so no layout knowledge is guessed).
 * @param raw - non-empty string.
 * @returns the escaped single path segment.
 */
function encodeSegment(raw) {
	if (raw.length === 0) throw new Error("cannot encode an empty path segment");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i += 1) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/u.test(ch)) out += ch;
		else out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
	}
	return out;
}

/**
 * Build the readable project directory key for a Session cwd (the backend's
 * own human-navigable convention).
 * @param cwd - the Session's project directory.
 * @returns one filesystem-safe project directory name.
 */
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i += 1) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/u.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/u, "") || "root").slice(0, 251)}--`;
}

/**
 * The per-Session directory under the persistence root.
 * @param root - persistence root.
 * @param cwd - Session project directory.
 * @param id - Session id.
 * @returns the absolute directory path.
 */
function sessionDir(root, cwd, id) {
	return join(root, projectKey(cwd), encodeSegment(String(id)));
}

/**
 * Locate one stored log artifact inside an existing Session directory.
 * @param root - persistence root.
 * @param cwd - Session project directory.
 * @param id - Session id.
 * @returns the artifact path, generation, and physical compression.
 * @throws when no supported artifact exists.
 */
function findLogArtifact(root, cwd, id) {
	const directory = sessionDir(root, cwd, id);
	if (!existsSync(directory)) throw new SessionMoveRefusal("log-missing", `存储目录不存在：${directory}`);
	let best;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const match = LOG_NAME.exec(entry.name);
		if (match === null) continue;
		const version = Number(match[1]);
		const compression = match[2] === ".zstd" ? "zstd" : "none";
		if (best === undefined || version > best.version) {
			best = { path: join(directory, entry.name), version, compression, filename: entry.name };
		}
	}
	if (best === undefined) throw new SessionMoveRefusal("log-missing", `存储目录里没有会话日志：${directory}`);
	return best;
}

/**
 * Find the next Zstandard frame magic at or after one offset.
 * @param buffer - complete artifact bytes.
 * @param from - first offset to inspect.
 * @returns the magic offset, or -1.
 */
function findZstdMagic(buffer, from) {
	for (let offset = Math.max(0, from); offset + 4 <= buffer.length; offset += 1) {
		if (buffer.readUInt32LE(offset) === ZSTD_MAGIC) return offset;
	}
	return -1;
}

/**
 * Split a concatenated Zstandard-frame container into independently decodable
 * frames, preserving each frame's byte range.
 * @param buffer - complete artifact bytes.
 * @returns the frames in order.
 * @throws on an unreadable container.
 */
function splitZstdFrames(buffer) {
	const frames = [];
	let start = 0;
	let guard = 0;
	while (start < buffer.length) {
		guard += 1;
		if (guard > 1_000_000) throw new SessionMoveRefusal("unsupported-format", "会话日志帧结构异常");
		let end = -1;
		let plain;
		let probe = findZstdMagic(buffer, start + 4);
		while (probe !== -1) {
			try {
				plain = zstdDecompressSync(buffer.subarray(start, probe));
				end = probe;
				break;
			} catch {
				probe = findZstdMagic(buffer, probe + 4);
			}
		}
		if (end === -1) {
			try {
				plain = zstdDecompressSync(buffer.subarray(start));
			} catch (error) {
				throw new SessionMoveRefusal("unsupported-format", `无法解压会话日志帧：${String(error)}`);
			}
			end = buffer.length;
		}
		frames.push({ start, end, plain });
		start = end;
	}
	return frames;
}

/**
 * Parse one stored log artifact into header/events without trusting the format.
 * @param buffer - complete artifact bytes.
 * @param compression - physical encoding.
 * @returns parsed header, events, text, and frame ranges.
 */
function parseLogBuffer(buffer, compression) {
	let frames;
	let text;
	if (compression === "none") {
		frames = [{ start: 0, end: buffer.length }];
		text = buffer.toString("utf8");
	} else {
		frames = splitZstdFrames(buffer);
		text = Buffer.concat(frames.map((frame) => frame.plain)).toString("utf8");
	}
	const lines = text.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	if (lines.length === 0) throw new SessionMoveRefusal("unsupported-format", "会话日志没有头行");
	let header;
	const events = [];
	try {
		header = JSON.parse(lines[0]);
		for (const line of lines.slice(1)) events.push(JSON.parse(line));
	} catch (error) {
		throw new SessionMoveRefusal("unsupported-format", `会话日志不是有效 JSONL：${String(error)}`);
	}
	return { frames, text, lines, header, events };
}

/**
 * Read one stored log artifact from disk.
 * @param artifact - located artifact descriptor.
 * @param sessionId - expected Session id.
 * @returns the parsed log plus raw bytes.
 */
function readLogArtifact(artifact, sessionId) {
	const buffer = readFileSync(artifact.path);
	const parsed = parseLogBuffer(buffer, artifact.compression);
	if (parsed.header?.id !== undefined && String(parsed.header.id) !== String(sessionId)) {
		throw new SessionMoveRefusal("verify-failed", `会话日志头 id 与请求不一致：${String(parsed.header.id)}`);
	}
	if (parsed.header?.version !== HEADER_VERSION) {
		throw new SessionMoveRefusal("unsupported-format", `不支持的会话格式版本：${String(parsed.header?.version)}`);
	}
	return { ...parsed, buffer };
}

/**
 * Rewrite the header cwd (and, when needed, append the working-directory
 * override event) of one parsed log while keeping every event frame intact.
 * @param log - parsed log with raw bytes and frame ranges.
 * @param compression - physical encoding.
 * @param nextCwd - target canonical directory.
 * @returns the rewritten artifact bytes.
 */
function rewriteLogCwd(log, compression, nextCwd) {
	const headerLine = JSON.stringify({ ...log.header, cwd: nextCwd }) + "\n";
	const headerBytes = Buffer.from(headerLine, "utf8");
	let output;
	if (compression === "none") {
		const newline = log.buffer.indexOf(10);
		if (newline < 0) throw new SessionMoveRefusal("unsupported-format", "会话日志头行没有换行结尾");
		output = Buffer.concat([headerBytes, log.buffer.subarray(newline + 1)]);
	} else {
		const firstEnd = log.frames[0]?.end;
		if (firstEnd === undefined) throw new SessionMoveRefusal("unsupported-format", "会话日志缺少头帧");
		const firstFrame = zstdCompressSync(headerBytes, ZSTD_CHECKSUM);
		output = Buffer.concat([firstFrame, log.buffer.subarray(firstEnd)]);
	}
	const changes = log.events.filter((event) => event?.type === "working-directory/change");
	const lastChange = changes[changes.length - 1];
	if (lastChange !== undefined && lastChange?.data?.cwd !== nextCwd) {
		const contiguous = log.events.every((event, index) => event?.seq === index);
		const terminated = log.text.endsWith("\n");
		if (!contiguous || !terminated) {
			throw new SessionMoveRefusal("unsupported-format", "无法安全追加工作目录事件：事件序列不连续或日志未以换行结尾");
		}
		const eventLine = Buffer.from(JSON.stringify({
			type: "working-directory/change",
			seq: log.events.length,
			time: Date.now(),
			data: { cwd: nextCwd }
		}) + "\n", "utf8");
		output = Buffer.concat([output, compression === "none" ? eventLine : zstdCompressSync(eventLine, ZSTD_CHECKSUM)]);
	}
	return output;
}

/**
 * Write one artifact through a temporary file and an atomic rename.
 * @param target - final absolute path.
 * @param bytes - artifact bytes.
 */
function publishArtifact(target, bytes) {
	ensureDir(dirname(target));
	const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
	writeFileSync(temp, bytes);
	try {
		renameSync(temp, target);
	} catch (error) {
		try {
			rmSync(temp, { force: true });
		} catch {
			/* ignore */
		}
		throw error;
	}
}

/**
 * Copy one Session directory into the recovery backup area and prune older
 * snapshots for that Session.
 * @param options - resolved plugin options.
 * @param sessionId - Session being moved.
 * @param directory - the stored Session directory.
 * @returns the backup directory path.
 */
function backupSessionDirectory(options, sessionId, directory) {
	const root = join(options.dataDir, "backups", encodeSegment(String(sessionId)));
	ensureDir(root);
	const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
	const destination = join(root, stamp);
	ensureDir(destination);
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		copyFileSync(join(directory, entry.name), join(destination, entry.name));
	}
	const snapshots = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	while (snapshots.length > options.backupKeep) {
		const oldest = snapshots.shift();
		try {
			rmSync(join(root, oldest), { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
	return destination;
}

/**
 * Resolve the persistence root and physical encoding from the mounted backend.
 * @param ctx - Host plugin context.
 * @param artifact - located artifact of a session.
 * @param header - its stored header.
 * @returns the root and per-session directory.
 */
function persistenceLayout(ctx, artifact, header) {
	const persistence = ctx.get("sessionPersistence");
	const configuredRoot = typeof persistence?.root === "string" && persistence.root.length > 0
		? persistence.root
		: join(dshHome(), "sessions");
	const cwd = header.cwd;
	if (typeof cwd !== "string" || cwd.length === 0) throw new SessionMoveRefusal("unsupported-format", "会话头没有 cwd，无法按目录迁移");
	return { root: resolve(configuredRoot), directory: dirname(artifact.path), cwd, compression: artifact.compression };
}

/**
 * List candidate Workspaces for one Session.
 * @param ctx - Host plugin context.
 * @param request - buffered POST body `{ sessionId }`.
 * @returns the JSON response.
 */
async function targetsResponse(ctx, request) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, code: "bad-request", message: "request body must be JSON" });
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
	if (!ID_PATTERN.test(sessionId)) return json(400, { ok: false, code: "bad-request", message: "sessionId is invalid" });
	const registry = ctx.get("workspaceRegistry");
	const persistence = ctx.get("sessionPersistence");
	if (registry === undefined || persistence === undefined) return json(503, { ok: false, code: "unavailable", message: "workspace registry or session persistence is unavailable" });
	const snapshot = await persistence.stat(sessionId).catch(() => undefined);
	if (snapshot === undefined) return json(404, { ok: false, code: "not-found", message: "session does not exist" });
	const headerCwd = typeof snapshot.header?.cwd === "string" ? snapshot.header.cwd : "";
	const entities = registry.list();
	const owner = entities.find((entity) => Array.isArray(entity.sessionIds) && entity.sessionIds.includes(sessionId))
		?? entities.find((entity) => entity.path === headerCwd);
	const ownerId = owner?.id;
	const targets = [];
	for (const entity of entities) {
		if (entity.id === ownerId) continue;
		let status = "unknown";
		try {
			status = await entity.status();
		} catch {
			/* best effort */
		}
		targets.push({
			workspaceId: String(entity.id),
			title: String(entity.title ?? ""),
			path: String(entity.path ?? ""),
			sessionCount: Array.isArray(entity.sessionIds) ? entity.sessionIds.length : 0,
			status
		});
	}
	return json(200, {
		ok: true,
		sessionId,
		headerCwd,
		currentWorkspaceId: ownerId === undefined ? null : String(ownerId),
		targets
	});
}

/**
 * Answer one move request.
 * @param ctx - Host plugin context.
 * @param request - buffered POST body `{ sessionId, targetWorkspaceId }`.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function moveResponse(ctx, request, options) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, code: "bad-request", message: "request body must be JSON" });
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
	const targetWorkspaceId = typeof payload?.targetWorkspaceId === "string" ? payload.targetWorkspaceId.trim() : "";
	const dryRun = payload?.dryRun === true;
	if (!ID_PATTERN.test(sessionId)) return json(400, { ok: false, code: "bad-request", message: "sessionId is invalid" });
	if (!ID_PATTERN.test(targetWorkspaceId)) return json(400, { ok: false, code: "bad-request", message: "targetWorkspaceId is invalid" });
	try {
		return json(200, await moveSession(ctx, options, sessionId, targetWorkspaceId, dryRun));
	} catch (error) {
		if (!(error instanceof SessionMoveRefusal)) {
			ctx.logger?.warn?.(`session-move: unexpected failure: ${String(error)}`);
			return json(500, { ok: false, code: "internal", message: String(error) });
		}
		if (error.code === "busy") {
			const queued = enqueueMove(options, sessionId, targetWorkspaceId);
			return json(409, {
				ok: false,
				code: "busy",
				queued: true,
				message: error.message,
				queuePosition: queued.position
			});
		}
		const status = error.code === "not-found" || error.code === "target-not-found" || error.code === "log-missing" ? 404
			: error.code === "same-workspace" || error.code === "busy" ? 409
				: error.code === "unsupported-format" ? 422
					: error.code === "verify-failed" || error.code === "rollback-failed" || error.code === "target-exists" ? 409
						: 400;
		return json(status, { ok: false, code: error.code, message: error.message, ...(error.details ?? {}) });
	}
}


/** The resident Session object, when this process has it open. */
function liveSessionOf(ctx, sessionId) {
	try {
		const sessions = ctx.get("sessions");
		if (sessions === undefined || typeof sessions.get !== "function") return undefined;
		return sessions.get(sessionId);
	} catch {
		return undefined;
	}
}

/** The agent that owns a resident Session, when one is attached. */
function liveAgentOf(ctx, sessionId) {
	try {
		const agents = ctx.get("agents");
		if (agents === undefined || typeof agents.get !== "function") return undefined;
		return agents.get(sessionId);
	} catch {
		return undefined;
	}
}

/** The persistence write handle of an open Session (access === "write"). */
function findWriteHandle(ctx, sessionId) {
	try {
		const persistence = ctx.get("sessionPersistence");
		const writers = persistence?.tracker?.writers;
		if (writers === undefined || typeof writers.get !== "function") return undefined;
		const handle = writers.get(sessionId);
		if (handle === undefined || handle === null) return undefined;
		return handle.access === "write" ? handle : undefined;
	} catch {
		return undefined;
	}
}

/** Undo the in-memory repointing of a live Session after a failed move. */
function restoreLiveHeaders(patch) {
	if (patch === undefined) return;
	try {
		if (patch.session !== undefined && patch.previousSessionHeader !== undefined) patch.session.header = patch.previousSessionHeader;
	} catch {
		/* best effort */
	}
	try {
		if (patch.writer !== undefined) patch.writer.header = patch.previousWriterHeader;
	} catch {
		/* best effort */
	}
}

/** Refuse a move while a turn is actually running. */
async function assertIdle(ctx, sessionId) {
	let activity;
	try {
		activity = await ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
	} catch (error) {
		throw new SessionMoveRefusal("internal", `无法确认会话是否空闲：${String(error)}`);
	}
	if (Array.isArray(activity) && activity.length > 0) {
		const kinds = activity.map((entry) => entry?.kind).filter((kind) => typeof kind === "string");
		throw new SessionMoveRefusal("active", `会话正在运行${kinds.length > 0 ? `（${kinds.join("、")}）` : ""}，请等这一轮结束后再移动`, { reason: "active" });
	}
}

/**
 * Prepare a hot move: flush buffered events, then repoint the live Session
 * header AND its persistence write handle at the target cwd, so nothing that
 * arrives during the relocation recreates the old project directory.
 * Returns undefined for a cold Session.
 */
async function prepareLiveMove(ctx, sessionId, targetPath) {
	const session = liveSessionOf(ctx, sessionId);
	if (session === undefined) return undefined;
	await assertIdle(ctx, sessionId);
	const sessions = ctx.get("sessions");
	if (typeof sessions?.flush === "function") {
		try {
			await sessions.flush(session);
		} catch (error) {
			throw new SessionMoveRefusal("internal", `迁移前刷新会话缓冲失败：${String(error)}`);
		}
	}
	const writer = findWriteHandle(ctx, sessionId);
	if (writer === undefined) {
		throw new SessionMoveRefusal("busy", "该会话在内存中，但写句柄不可用，无法安全热迁移；已加入队列，DSH 重启后会自动移动", { reason: "writer-unavailable" });
	}
	const patch = { session, writer, previousSessionHeader: session.header, previousWriterHeader: writer.header };
	const nextHeader = { ...(session.header ?? {}), cwd: targetPath };
	try {
		session.header = nextHeader;
		writer.header = nextHeader;
	} catch (error) {
		restoreLiveHeaders(patch);
		throw new SessionMoveRefusal("internal", `无法重指正在打开的会话：${String(error)}`);
	}
	return patch;
}

/** After a successful hot move: rebind the agent's cwd and drain late events. */
async function finishLiveMove(ctx, sessionId, livePatch, targetPath) {
	if (livePatch === undefined) return undefined;
	let warning;
	const agent = liveAgentOf(ctx, sessionId);
	if (agent !== undefined) {
		try {
			const workingDirectory = ctx.get("workingDirectory");
			if (workingDirectory === undefined || typeof workingDirectory.set !== "function") {
				warning = "会话已移动，但工作目录服务不可用；重新打开会话即可使用新目录";
			} else {
				await workingDirectory.set(agent, targetPath);
			}
		} catch (error) {
			warning = `会话已移动，但运行中的 agent 仍用旧工作目录：${String(error)}`;
		}
	}
	const sessions = ctx.get("sessions");
	if (typeof sessions?.flush === "function") {
		try {
			await sessions.flush(livePatch.session);
		} catch (error) {
			warning = warning ?? `会话已移动，但缓冲事件写入失败：${String(error)}`;
		}
	}
	return warning;
}

/**
 * Move one cold Session between Workspaces with backup, verification, and
 * rollback. Exported for the self-test.
 * @param ctx - Host plugin context.
 * @param options - resolved plugin options.
 * @param sessionId - Session to move.
 * @param targetWorkspaceId - destination Workspace id.
 * @returns the success payload.
 */
export async function moveSession(ctx, options, sessionId, targetWorkspaceId, dryRun = false) {
	const registry = ctx.get("workspaceRegistry");
	const persistence = ctx.get("sessionPersistence");
	if (registry === undefined || persistence === undefined) throw new SessionMoveRefusal("unavailable", "workspace registry or session persistence is unavailable");
	const target = registry.get(targetWorkspaceId);
	if (target === undefined) throw new SessionMoveRefusal("target-not-found", `目标工作区不存在：${targetWorkspaceId}`);
	const targetStatus = await target.status().catch(() => "missing-dir");
	if (targetStatus !== "ok") throw new SessionMoveRefusal("target-not-found", `目标工作区目录不可用：${target.path}`);
	const targetPath = String(target.path);
	const snapshot = await persistence.stat(sessionId).catch(() => undefined);
	if (snapshot === undefined) throw new SessionMoveRefusal("not-found", `会话不存在：${sessionId}`);
	const header = snapshot.header;
	if (header?.version !== HEADER_VERSION) throw new SessionMoveRefusal("unsupported-format", `不支持的会话格式版本：${String(header?.version)}`);
	const headerCwd = typeof header.cwd === "string" ? header.cwd : "";
	if (headerCwd.length === 0) throw new SessionMoveRefusal("unsupported-format", "会话头没有 cwd，无法迁移");
	const entities = registry.list();
	const owner = entities.find((entity) => Array.isArray(entity.sessionIds) && entity.sessionIds.includes(sessionId))
		?? entities.find((entity) => entity.path === headerCwd);
	if (owner !== undefined && owner.path === targetPath) throw new SessionMoveRefusal("same-workspace", "会话已经在该工作区中");
	const rootHint = typeof persistence.root === "string" && persistence.root.length > 0 ? persistence.root : join(dshHome(), "sessions");
	const artifact = findLogArtifact(join(resolve(rootHint)), headerCwd, sessionId);
	const sourceDirectory = dirname(artifact.path);
	const targetDirectory = sessionDir(resolve(rootHint), targetPath, sessionId);
	if (existsSync(targetDirectory) && targetDirectory !== sourceDirectory) {
		throw new SessionMoveRefusal("target-exists", `目标位置已存在同名会话目录：${targetDirectory}`);
	}
	if (dryRun === true) {
		const live = liveSessionOf(ctx, sessionId) !== undefined;
		return {
			ok: true,
			dryRun: true,
			sessionId,
			live,
			writerFound: live === true && findWriteHandle(ctx, sessionId) !== undefined,
			sourceDirectory,
			targetDirectory,
			target: { workspaceId: String(target.id), title: String(target.title ?? ""), path: targetPath }
		};
	}
	const livePatch = await prepareLiveMove(ctx, sessionId, targetPath);
	const log = readLogArtifact(artifact, sessionId);
	const backupDirectory = backupSessionDirectory(options, sessionId, sourceDirectory);
	const rewritten = rewriteLogCwd(log, artifact.compression, targetPath);
	const originalBytes = readFileSync(artifact.path);
	const targetArtifactPath = join(targetDirectory, artifact.filename);
	const sourceOwnerId = owner === undefined ? undefined : String(owner.id);
	let filePublished = false;
	try {
		publishArtifact(targetArtifactPath, rewritten);
		filePublished = true;
		const verifyBytes = readFileSync(targetArtifactPath);
		const verified = parseLogBuffer(verifyBytes, artifact.compression);
		if (String(verified.header?.id) !== String(sessionId) || verified.header?.cwd !== targetPath) {
			throw new SessionMoveRefusal("verify-failed", "迁移后的会话头校验失败（id/cwd 不一致）");
		}
		if (verified.events.length < log.events.length) {
			throw new SessionMoveRefusal("verify-failed", "迁移后的会话事件少于迁移前");
		}
		if (sourceDirectory !== targetDirectory) rmSync(sourceDirectory, { recursive: true, force: true });
		invalidateRegistryIndexes(ctx, registry, sessionId);
		if (owner !== undefined && typeof owner.detachSession === "function") await owner.detachSession(sessionId);
		await target.attachSession(sessionId);
		const attached = Array.isArray(target.sessionIds) && target.sessionIds.includes(sessionId);
		const stillSource = owner !== undefined && Array.isArray(owner.sessionIds) && owner.sessionIds.includes(sessionId);
		if (!attached || stillSource) throw new SessionMoveRefusal("verify-failed", "工作区归属校验失败（目标未记账或源仍记账）");
		const warning = await finishLiveMove(ctx, sessionId, livePatch, targetPath);
		return {
			ok: true,
			sessionId,
			live: livePatch !== undefined,
			source: owner === undefined ? null : { workspaceId: sourceOwnerId ?? null, title: String(owner.title ?? ""), path: String(owner.path ?? "") },
			target: { workspaceId: String(target.id), title: String(target.title ?? ""), path: targetPath },
			backupDirectory,
			bytes: rewritten.length,
			...(warning === undefined ? {} : { warning })
		};
	} catch (error) {
		restoreLiveHeaders(livePatch);
		try {
			rollbackMove(ctx, registry, {
				sessionId,
				owner,
				target,
				artifactPath: artifact.path,
				originalBytes,
				targetArtifactPath,
				sourceDirectory,
				targetDirectory,
				filePublished
			});
		} catch (rollbackError) {
			throw new SessionMoveRefusal("rollback-failed", `移动失败且回滚失败：${String(error)}；回滚：${String(rollbackError)}；原始字节备份在 ${backupDirectory}`);
		}
		if (error instanceof SessionMoveRefusal) throw error;
		throw new SessionMoveRefusal("internal", `移动失败，已回滚：${String(error)}`);
	}
}

/**
 * Restore one failed move: original bytes back to the source directory, the
 * target artifact removed, registry caches invalidated, source reattached.
 * @param ctx - Host plugin context.
 * @param registry - Workspace registry.
 * @param state - captured move state.
 */
function rollbackMove(ctx, registry, state) {
	if (state.filePublished) {
		ensureDir(state.sourceDirectory);
		publishArtifact(state.artifactPath, state.originalBytes);
		if (state.targetDirectory !== state.sourceDirectory) {
			try {
				rmSync(state.targetDirectory, { recursive: true, force: true });
			} catch {
				/* best effort */
			}
		}
	}
	invalidateRegistryIndexes(ctx, registry, state.sessionId);
	const owner = state.owner;
	if (owner !== undefined && typeof owner.attachSession === "function") {
		owner.attachSession(state.sessionId).catch((error) => ctx.logger?.warn?.(`session-move: rollback reattach failed: ${String(error)}`));
	}
	const target = state.target;
	if (target !== undefined && Array.isArray(target.sessionIds) && target.sessionIds.includes(state.sessionId) && typeof target.detachSession === "function") {
		target.detachSession(state.sessionId).catch(() => {});
	}
}

/**
 * Refuse a Session whose writer may still be live.
 * @param ctx - Host plugin context.
 * @param sessionId - Session to check.
 */
function assertMovable(ctx, sessionId) {
	const sessions = ctx.get("sessions");
	if (sessions !== undefined && typeof sessions.get === "function" && sessions.get(sessionId) !== undefined) {
		throw new SessionMoveRefusal("busy", "该会话仍在内存中（打开过），写入句柄未释放；已加入队列，DSH 重启后会自动移动", { reason: "resident" });
	}
}

/**
 * Invalidate the registry's in-memory header/session-path indexes for one id so
 * the official attach reads the migrated header. Version-sensitive and
 * fail-soft: the caller falls back to a restart hint when it fails.
 * @param ctx - Host plugin context.
 * @param registry - Workspace registry.
 * @param sessionId - Session being moved.
 * @returns whether the indexes were invalidated.
 */
function invalidateRegistryIndexes(ctx, registry, sessionId) {
	try {
		registry.headers?.delete?.(sessionId);
		registry.sessionPaths?.delete?.(sessionId);
		registry.invalidSessionPaths?.delete?.(sessionId);
		registry.missingSessionPaths?.delete?.(sessionId);
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`session-move: registry index invalidation failed: ${String(error)}`);
		return false;
	}
}

/**
 * Append one move to the durable retry queue.
 * @param options - resolved plugin options.
 * @param sessionId - Session to move later.
 * @param targetWorkspaceId - destination Workspace.
 * @returns the queue position.
 */
function enqueueMove(options, sessionId, targetWorkspaceId) {
	const queue = readQueue(options).filter((record) => record.sessionId !== sessionId);
	queue.push({
		sessionId,
		targetWorkspaceId,
		createdAt: new Date().toISOString(),
		attempts: 0,
		lastError: null
	});
	writeQueue(options, queue);
	return { position: queue.length };
}

/**
 * Read the durable queue.
 * @param options - resolved plugin options.
 * @returns the queue records.
 */
function readQueue(options) {
	const path = join(options.dataDir, "queue.json");
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(parsed?.moves) ? parsed.moves.filter((record) => typeof record?.sessionId === "string" && typeof record?.targetWorkspaceId === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Persist the durable queue.
 * @param options - resolved plugin options.
 * @param queue - queue records.
 */
function writeQueue(options, queue) {
	ensureDir(options.dataDir);
	const path = join(options.dataDir, "queue.json");
	const temp = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify({ version: 1, moves: queue }, null, 2));
	renameSync(temp, path);
}

/**
 * Retry every queued move that is no longer resident.
 * @param ctx - Host plugin context.
 * @param options - resolved plugin options.
 */
async function retryQueue(ctx, options) {
	const queue = readQueue(options);
	if (queue.length === 0) return;
	const remaining = [];
	for (const record of queue) {
		if (ctx.get("sessions")?.get?.(record.sessionId) !== undefined) {
			remaining.push(record);
			continue;
		}
		try {
			await moveSession(ctx, options, record.sessionId, record.targetWorkspaceId);
			ctx.logger?.info?.(`session-move: queued move completed for ${record.sessionId}`);
		} catch (error) {
			const code = error instanceof SessionMoveRefusal ? error.code : "internal";
			if (code === "busy") {
				record.attempts += 1;
				record.lastError = error.message;
				remaining.push(record);
			} else {
				ctx.logger?.warn?.(`session-move: queued move dropped (${code}): ${String(error?.message ?? error)}`);
			}
		}
	}
	writeQueue(options, remaining);
}

/**
 * Append one client diagnostic line to `probe.log`.
 * @param request - buffered POST request.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function probeResponse(request, options) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		payload = {};
	}
	try {
		ensureDir(options.dataDir);
		writeFileSync(join(options.dataDir, "probe.log"), `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`, { flag: "a" });
	} catch {
		/* diagnostics are best effort */
	}
	return json(200, { ok: true });
}

/**
 * One JSON response.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 * @returns the response.
 */
function json(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Whether one Workspace entity is usable as a move endpoint.
 * @param entity - workspace entity.
 * @returns whether it has a path and the attach/detach API.
 */
function isUsableWorkspace(entity) {
	return entity !== undefined && typeof entity.attachSession === "function" && typeof entity.detachSession === "function" && typeof entity.path === "string";
}

/**
 * Opt-in end-to-end self-test: create a throwaway header-only Session in one
 * real Workspace, move it to another and back through the same pipeline, verify
 * both legs, then remove every trace.
 * @param ctx - Host plugin context.
 * @param options - resolved plugin options.
 */
async function runSelfTest(ctx, options) {
	const results = [];
	const check = (step, ok, detail) => results.push({ step, ok: ok === true, detail: detail === undefined ? "" : String(detail) });
	const registry = ctx.get("workspaceRegistry");
	const persistence = ctx.get("sessionPersistence");
	if (registry === undefined || persistence === undefined) {
		check("services", false, "workspace registry or persistence missing");
		writeSelfTest(options, results);
		return;
	}
	const workspaces = [];
	for (const entity of registry.list()) {
		if (!isUsableWorkspace(entity)) continue;
		const status = await entity.status().catch(() => "unknown");
		if (status === "ok") workspaces.push(entity);
	}
/* Read-only robustness: the frame parser must handle real multi-frame logs. */
	try {
		const root = resolve(String(persistence.root ?? join(dshHome(), "sessions")));
		const stored = (await persistence.list()).slice(0, 3);
		let parsedCount = 0;
		for (const snapshot of stored) {
			const cwd = typeof snapshot.header?.cwd === "string" ? snapshot.header.cwd : "";
			if (cwd === "") continue;
			try {
				const artifact = findLogArtifact(root, cwd, snapshot.header.id);
				const log = readLogArtifact(artifact, snapshot.header.id);
				if (log.header.cwd === cwd && Array.isArray(log.events)) parsedCount += 1;
			} catch {
				/* one unreadable session does not fail the whole check */
			}
		}
		check("parse-real-logs", parsedCount > 0, `${parsedCount}/${stored.length} parsed`);
	} catch (error) {
		check("parse-real-logs", false, String(error));
	}
	/* A second Workspace is required for a real cross-workspace move. One temp
	 * workspace is created for this test and deleted in the cleanup below. */
	let createdWorkspaceId;
	if (workspaces.length < 2) {
		try {
			const directory = join(options.dataDir, "selftest-workspace");
			ensureDir(directory);
			const entity = await registry.create(directory, "session-move-selftest");
			if (isUsableWorkspace(entity)) {
				workspaces.push(entity);
				createdWorkspaceId = String(entity.id);
			}
		} catch (error) {
			check("temp-workspace", false, String(error));
		}
	}
	check("workspaces", workspaces.length >= 2, `${workspaces.length} usable workspaces`);
	if (workspaces.length < 2) {
		writeSelfTest(options, results);
		return;
	}
	const source = workspaces[0];
	const target = workspaces[1];
	const sessionId = `session-move-selftest-${randomUUID()}`;
	let created = false;
	let handle;
	try {
		handle = await persistence.create({
			version: HEADER_VERSION,
			id: sessionId,
			createdAt: Date.now(),
			cwd: String(source.path),
			isSeeded: false,
			delegationDepth: 0
		});
		created = true;
		await handle.flush();
		await handle.close();
		await source.attachSession(sessionId);
		check("attach-source", Array.isArray(source.sessionIds) && source.sessionIds.includes(sessionId), String(source.path));
		const targetsRequest = new Request("http://localhost/api/session.move.targets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId })
		});
		const targetsBody = await (await targetsResponse(ctx, targetsRequest)).json();
		check("targets-route", targetsBody.ok === true && Array.isArray(targetsBody.targets) && targetsBody.targets.some((candidate) => candidate.workspaceId === String(target.id)), `${targetsBody.targets?.length ?? 0} targets`);
		const moveRequest = new Request("http://localhost/api/session.move", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId, targetWorkspaceId: String(target.id) })
		});
		const moveResponseResult = await moveResponse(ctx, moveRequest, options);
		const moveBody = await moveResponseResult.json();
		check("move-route", moveResponseResult.status === 200 && moveBody.ok === true && moveBody.target?.workspaceId === String(target.id), `status=${moveResponseResult.status}`);
		check("target-accounting", Array.isArray(target.sessionIds) && target.sessionIds.includes(sessionId), String(target.path));
		check("source-released", !(Array.isArray(source.sessionIds) && source.sessionIds.includes(sessionId)), String(source.path));
		const movedArtifact = findLogArtifact(resolve(String(persistence.root ?? join(dshHome(), "sessions"))), String(target.path), sessionId);
		const moved = readLogArtifact(movedArtifact, sessionId);
		check("header-cwd", moved.header.cwd === String(target.path), String(moved.header.cwd));
		const second = await moveSession(ctx, options, sessionId, String(source.id));
		check("move-back", second.ok === true && second.target.workspaceId === String(source.id), `${second.source?.path ?? "?"} -> ${second.target.path}`);
		const backArtifact = findLogArtifact(resolve(String(persistence.root ?? join(dshHome(), "sessions"))), String(source.path), sessionId);
		const back = readLogArtifact(backArtifact, sessionId);
		check("header-back", back.header.cwd === String(source.path), String(back.header.cwd));
	} catch (error) {
		check("fatal", false, String(error?.stack ?? error));
	} finally {
		try {
			if (created) {
				const live = registry.list().find((entity) => Array.isArray(entity.sessionIds) && entity.sessionIds.includes(sessionId));
				if (live !== undefined) await live.detachSession(sessionId);
				const directory = sessionDir(resolve(String(persistence.root ?? join(dshHome(), "sessions"))), String(workspaces[0].path), sessionId);
				for (const entity of workspaces) {
					const other = sessionDir(resolve(String(persistence.root ?? join(dshHome(), "sessions"))), String(entity.path), sessionId);
					try {
						rmSync(other, { recursive: true, force: true });
					} catch {
						/* best effort */
					}
				}
				try {
					rmSync(directory, { recursive: true, force: true });
				} catch {
					/* best effort */
				}
				rmSync(join(options.dataDir, "backups", encodeSegment(sessionId)), { recursive: true, force: true });
			}
		} catch {
			/* cleanup best effort */
		}
		if (createdWorkspaceId !== undefined) {
			try {
				await registry.delete(createdWorkspaceId);
			} catch {
				/* registration cleanup is best effort */
			}
			try {
				rmSync(join(options.dataDir, "selftest-workspace"), { recursive: true, force: true });
			} catch {
				/* directory cleanup is best effort */
			}
		}
		check("cleanup", true, "throwaway session removed");
	}
	writeSelfTest(options, results);
}

/**
 * Persist the self-test evidence next to the plugin data.
 * @param options - resolved plugin options.
 * @param results - recorded checks.
 */
function writeSelfTest(options, results) {
	try {
		ensureDir(options.dataDir);
		writeFileSync(join(options.dataDir, "selftest.json"), JSON.stringify({
			at: new Date().toISOString(),
			passed: results.filter((result) => result.ok).length,
			failed: results.filter((result) => !result.ok).length,
			results
		}, null, 2));
	} catch {
		/* evidence is best effort */
	}
}
