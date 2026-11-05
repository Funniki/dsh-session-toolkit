/**
 * Host half of the unsent-content guard.
 *
 * The composer keeps unsent input in the browser only: image drafts hold their
 * bytes until send time, and the text draft lives in the editor. A crash, a
 * restart, or a failed send can lose either. This plugin keeps a durable copy of
 * every image draft and of the current text draft per session, and deletes a
 * copy only after the content is committed to a session log by a successful
 * send (`user/message`).
 *
 * Deletion is decided by the Host, not the browser: only the committed
 * `user/message` event is authoritative about what was really sent. Failure,
 * draft removal, session switching and restart keep the copy — the composer
 * keeps the draft too, so the file remains a recoverable backup.
 *
 * Images are keyed by the same content identity a committed message will carry:
 * the draft bytes pass through the mounted attachment service (`saveImage`),
 * which normalizes them exactly as a real send would, and the resulting
 * `attachmentId` (`sha256:…`) is recorded. A committed image part carries that
 * id, so matching needs no heuristic. Images the attachment service refuses are
 * still saved with a raw `sha256:` id and left in place: a send would fail for
 * them anyway.
 *
 * Text is keyed by the digest of the exact draft text (plus its trimmed form).
 * A committed `user/message` whose text part hashes to that digest deletes the
 * saved text copy.
 *
 * Nothing here imports a Harness package: the plugin uses only Node builtins,
 * the shared `connection` carrier, and services reached through `ctx`.
 *
 * @module dsh-unsent-content-guard
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/** Stable Cordis plugin name. */
export const name = "unsent-content-guard";

/** The authenticated Fetch carrier that serves the plugin's routes. */
export const inject = ["connection"];

/** Route pathnames (under the shared `/api` channel). */
const SAVE_IMAGE_PATH = "/api/unsent-content/save-image";
const SAVE_TEXT_PATH = "/api/unsent-content/save-text";
const LIST_PATH = "/api/unsent-content/list";
const REVEAL_PATH = "/api/unsent-content/reveal";
const DISCARD_PATH = "/api/unsent-content/discard";
const PROBE_PATH = "/api/unsent-content/probe";
const READ_IMAGE_PATH = "/api/unsent-content/read-image";

/** Index file name inside the storage root. */
const INDEX_NAME = "index.json";

/** Accepted image media types and their file extension. */
const MEDIA_EXTENSIONS = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif"
};

/** Largest single image draft this route accepts, in bytes. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/** Largest text draft this route accepts, in UTF-16 code units. */
const MAX_TEXT_LENGTH = 2_000_000;

/** Session and draft ids are host-minted but re-validated before shaping a path. */
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

/** A tiny valid PNG used by the opt-in self-test. */
const SELFTEST_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * Register the routes, the committed-content cleanup, and the optional self-test.
 * @param ctx - Host plugin context.
 * @param config - optional row configuration: `root`, `enabled`, `retainDays`, `selfTest`.
 */
export function apply(ctx, config) {
	const options = resolveOptions(config);
	if (!options.enabled) return;
	const store = new DraftStore(options.root, ctx.logger);
	const connection = ctx.get("connection");
	if (connection === undefined) return;

	/** Bounded diagnostic log: written only while `config.debugEvents` is on. */
	const debugSeen = new Map();
	const debugLog = (line) => {
		if (!options.debugEvents) return;
		try {
			void mkdir(options.root, { recursive: true }).then(() => appendFile(
				join(options.root, "debug-events.log"),
				`${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`
			)).catch(() => {});
		} catch {
			/* Diagnostics never affect behavior. */
		}
	};
	/** Log at most five lines per event type, so tool chatter cannot flood the file. */
	const debugEvent = (type, line) => {
		if (!options.debugEvents) return;
		const seen = debugSeen.get(type) ?? 0;
		if (seen >= 5) return;
		debugSeen.set(type, seen + 1);
		debugLog(line);
	};

	const routes = [
		["save-image", SAVE_IMAGE_PATH, (request) => handleSaveImage(ctx, request, store, options)],
		["save-text", SAVE_TEXT_PATH, (request) => handleSaveText(request, store, options)],
		["read-image", READ_IMAGE_PATH, (request) => handleReadImage(ctx, request, store)],
		["list", LIST_PATH, () => handleList(store, options)],
		["reveal", REVEAL_PATH, () => handleReveal(store, options)],
		["discard", DISCARD_PATH, (request) => handleDiscard(request, store)],
		["probe", PROBE_PATH, (request) => handleProbe(request, options)]
	];
	for (const [label, path, handler] of routes) {
		ctx.effect(() => connection.fetch.register({
			path,
			methods: ["POST"],
			requestBody: "buffered",
			fetch: handler
		}), `unsent-content-guard: ${label} route`);
	}

	ctx.effect(() => ctx.on("session/event", (session, event) => {
		const type = typeof event?.type === "string" ? event.type : "";
		debugEvent(type, {
			phase: "session-event",
			type,
			sessionId: session?.id
		});
		if (type !== "user/message") return;
		try {
			const committed = committedContent(event);
			if (options.debugEvents) debugLog({
				phase: "committed-user-message",
				sessionId: session?.id,
				imageIds: committed.imageIds,
				textHashes: committed.textHashes
			});
			if (committed.imageIds.length === 0 && committed.textHashes.length === 0) return;
			store.removeCommitted(committed.imageIds, committed.textHashes).then((removed) => {
				if (options.debugEvents) debugLog({ phase: "committed-removed", removed, sessionId: session?.id });
				if (removed > 0) ctx.logger?.info?.(`unsent-content-guard: removed ${String(removed)} committed draft cop${removed === 1 ? "y" : "ies"}`);
			}, (error) => {
				if (options.debugEvents) debugLog({ phase: "committed-error", message: String(error) });
				ctx.logger?.warn(`unsent-content-guard: removing committed draft copies failed: ${String(error)}`);
			});
		} catch (error) {
			if (options.debugEvents) debugLog({ phase: "committed-throw", message: String(error) });
			ctx.logger?.warn(`unsent-content-guard: committed-content observer failed: ${String(error)}`);
		}
	}, { global: true }), "unsent-content-guard: committed-content cleanup");

	if (options.retainDays > 0) {
		store.pruneOlderThan(options.retainDays).catch((error) => {
			ctx.logger?.warn(`unsent-content-guard: retention sweep failed: ${String(error)}`);
		});
	}

	if (options.selfTest) {
		runSelfTest(ctx, store, options).catch((error) => {
			ctx.logger?.warn(`unsent-content-guard: self-test failed: ${String(error)}`);
		});
	}
}

/**
 * Resolve row configuration into complete options.
 * @param config - raw row config, when present.
 * @returns the normalized options.
 */
function resolveOptions(config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const configuredRoot = typeof raw.root === "string" ? raw.root.trim() : "";
	const retainDays = Number(raw.retainDays);
	const restoreMaxAgeHours = Number(raw.restoreMaxAgeHours);
	return {
		enabled: raw.enabled !== false,
		root: configuredRoot === "" ? join(resolveDshHome(), "unsent-content") : resolve(configuredRoot),
		retainDays: Number.isFinite(retainDays) && retainDays > 0 ? retainDays : 0,
		selfTest: raw.selfTest === true,
		debugEvents: raw.debugEvents === true,
		restoreOnOpen: raw.restoreOnOpen !== false,
		restoreMaxAgeHours: Number.isFinite(restoreMaxAgeHours) && restoreMaxAgeHours > 0 ? restoreMaxAgeHours : 24
	};
}

/**
 * The resolved harness home: `$DSH_HOME` when set and non-blank, else `~/.dsh`.
 * @returns the absolute harness home path.
 */
function resolveDshHome() {
	const configured = (process.env.DSH_HOME ?? "").trim();
	return configured.length > 0 ? resolve(configured) : join(homedir(), ".dsh");
}

/**
 * Answer one image save request: normalize the draft, write the durable copy, index it.
 * @param ctx - Host plugin context.
 * @param request - the buffered POST request.
 * @param store - the draft store.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function handleSaveImage(ctx, request, store, options) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, message: "request body must be JSON" });
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
	const draftId = typeof payload?.draftId === "string" ? payload.draftId : "";
	const mediaType = typeof payload?.mediaType === "string" ? payload.mediaType : "";
	const rawName = typeof payload?.name === "string" ? payload.name : "";
	if (!ID_PATTERN.test(sessionId) || !ID_PATTERN.test(draftId)) return json(400, { ok: false, message: "sessionId and draftId must be ids" });
	const extension = MEDIA_EXTENSIONS[mediaType];
	if (extension === undefined) return json(415, { ok: false, message: `unsupported image media type: ${mediaType || "(empty)"}` });
	if (typeof payload?.data !== "string") return json(400, { ok: false, message: "data must be base64" });

	let bytes;
	try {
		bytes = Buffer.from(payload.data, "base64");
	} catch {
		return json(400, { ok: false, message: "data must be base64" });
	}
	if (bytes.length === 0) return json(400, { ok: false, message: "image is empty" });
	if (bytes.length > MAX_IMAGE_BYTES) return json(413, { ok: false, message: `image exceeds ${String(MAX_IMAGE_BYTES)} bytes` });

	await store.ensure();
	const existing = await store.findImage(draftId, sessionId);
	if (existing !== undefined) return json(200, { ok: true, ...(await store.counts()), attachmentId: existing.attachmentId, duplicate: true });

	const name = safeDisplayName(rawName, extension);
	const identity = await resolveAttachmentId(ctx, bytes, mediaType, name);
	/* Content its Session already committed is not unsent: skip the copy entirely so a
	 * restored draft (or any stale browser capture) cannot re-create a backup. */
	if (identity.normalized) {
		const sessionsService = ctx.get("sessions");
		const live = sessionsService === undefined || typeof sessionsService.get !== "function" ? undefined : sessionsService.get(sessionId);
		if (live !== undefined && typeof live.snapshotEvents === "function") {
			const committed = live.snapshotEvents().some((event) => event.type === "user/message" && committedContent(event).imageIds.includes(identity.attachmentId));
			if (committed) {
				return json(200, {
					ok: true,
					skipped: true,
					sent: true,
					...(await store.counts()),
					attachmentId: identity.attachmentId
				});
			}
		}
	}
	const relative = join("images", safeSegment(sessionId), `${safeSegment(draftId)}-${name}`);
	const absolute = join(options.root, relative);
	try {
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, bytes);
	} catch (error) {
		return json(500, { ok: false, message: `writing the backup failed: ${String(error)}` });
	}
	const counts = await store.add({
		kind: "image",
		draftId,
		sessionId,
		attachmentId: identity.attachmentId,
		normalized: identity.normalized,
		name,
		mediaType,
		bytes: bytes.length,
		savedAt: Date.now(),
		file: relative
	});
	return json(200, { ok: true, ...counts, attachmentId: identity.attachmentId, path: absolute });
}

/**
 * Identify the image exactly as a send would, falling back to the raw digest when
 * the mounted attachment service refuses the bytes (over deployment limits).
 * @param ctx - Host plugin context.
 * @param bytes - original draft bytes.
 * @param mediaType - declared image media type.
 * @param name - display name.
 * @returns the content identity and whether it came from the attachment service.
 */
async function resolveAttachmentId(ctx, bytes, mediaType, name) {
	const attachments = ctx.get("attachments");
	if (attachments !== undefined && typeof attachments.saveImage === "function") {
		try {
			const reference = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name });
			return { attachmentId: String(reference.attachmentId), normalized: true };
		} catch {
			/* An image the deployment rejects can never be sent; keep a raw-id copy. */
		}
	}
	return { attachmentId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, normalized: false };
}

/**
 * Answer one text save request: keep the latest unsent draft text per session.
 * @param request - the buffered POST request.
 * @param store - the draft store.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function handleSaveText(request, store, options) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, message: "request body must be JSON" });
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
	if (!ID_PATTERN.test(sessionId)) return json(400, { ok: false, message: "sessionId must be an id" });
	if (typeof payload?.text !== "string") return json(400, { ok: false, message: "text must be a string" });
	if (payload.text.length > MAX_TEXT_LENGTH) return json(413, { ok: false, message: `text exceeds ${String(MAX_TEXT_LENGTH)} characters` });
	const text = normalizeNewlines(payload.text);
	if (text.trim() === "") return json(200, { ok: true, skipped: true, ...(await store.counts()) });

	const stored = await store.putText(sessionId, text, options);
	return json(200, { ok: true, ...stored.counts, hash: stored.hash, path: stored.path });
}

/**
 * Keep newlines canonical so the digest matches the committed message text.
 * @param value - draft or committed text.
 * @returns the normalized text.
 */
function normalizeNewlines(value) {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Digests recorded for one text value: exact and trimmed.
 * @param text - normalized text.
 * @returns the two digests.
 */
function textHashes(text) {
	return [
		createHash("sha256").update(text).digest("hex"),
		createHash("sha256").update(text.trim()).digest("hex")
	];
}

/**
 * Read one saved image back into the browser so a composer can restore the
 * draft a Session switch dropped. Refuses (and drops) a copy whose content the
 * owning Session already committed, so a stale backup can never resurrect an
 * image the person already sent.
 * @param ctx - Host plugin context.
 * @param request - the buffered POST request.
 * @param store - the draft store.
 * @returns the JSON response with base64 bytes.
 */
async function handleReadImage(ctx, request, store) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, message: "request body must be JSON" });
	}
	const draftId = typeof payload?.draftId === "string" ? payload.draftId : "";
	if (!ID_PATTERN.test(draftId)) return json(400, { ok: false, message: "draftId must be an id" });
	await store.ensure();
	const entry = (await store.snapshot()).find((candidate) => candidate.kind === "image" && candidate.draftId === draftId);
	if (entry === undefined) return json(404, { ok: false, message: "no saved image for this draft" });
	/* A stale backup may outlive a send (older builds' cleanup could fail). Never
	 * restore content the owning Session already committed: drop the copy instead. */
	const sessions = ctx.get("sessions");
	const live = sessions === undefined || typeof sessions.get !== "function" ? undefined : sessions.get(entry.sessionId);
	if (live !== undefined && typeof live.snapshotEvents === "function") {
		const sent = live.snapshotEvents().some((event) => event.type === "user/message" && committedContent(event).imageIds.includes(entry.attachmentId));
		if (sent) {
			const removed = await store.removeByAttachmentIds([entry.attachmentId]);
			return json(409, {
				ok: false,
				sent: true,
				removed,
				message: "this image is already committed in its Session"
			});
		}
	}
	let bytes;
	try {
		bytes = await readFile(store.absolutePath(entry.file) ?? "");
	} catch (error) {
		return json(404, { ok: false, message: `saved image is unreadable: ${String(error)}` });
	}
	return json(200, {
		ok: true,
		draftId,
		name: typeof entry.name === "string" ? entry.name : `${draftId}.png`,
		mediaType: typeof entry.mediaType === "string" ? entry.mediaType : "image/png",
		bytes: bytes.length,
		data: bytes.toString("base64")
	});
}

/**
 * Answer one list request.
 * @param store - the draft store.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function handleList(store, options) {
	await store.ensure();
	const entries = await store.snapshot();
	const images = entries.filter((entry) => entry.kind === "image");
	return json(200, {
		ok: true,
		images: images.length,
		texts: countDistinctTexts(entries),
		count: entries.length,
		root: options.root,
		restore: {
			onOpen: options.restoreOnOpen,
			maxAgeHours: options.restoreMaxAgeHours
		},
		entries: entries.map((entry) => entry.kind === "image" ? {
			kind: "image",
			draftId: entry.draftId,
			name: entry.name,
			mediaType: entry.mediaType,
			bytes: entry.bytes,
			savedAt: entry.savedAt,
			sessionId: entry.sessionId,
			file: entry.file
		} : {
			kind: "text",
			chars: entry.text.length,
			savedAt: entry.savedAt,
			sessionId: entry.sessionId,
			preview: entry.text.length > 200 ? `${entry.text.slice(0, 200)}…` : entry.text,
			file: entry.file
		})
	});
}

/**
 * Answer one reveal request by opening the storage root in the OS file manager.
 * @param store - the draft store.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function handleReveal(store, options) {
	try {
		await mkdir(options.root, { recursive: true });
	} catch (error) {
		return json(500, { ok: false, message: `creating the storage root failed: ${String(error)}` });
	}
	const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
	try {
		const child = spawn(command, [options.root], { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
	} catch (error) {
		return json(500, { ok: false, message: `opening the folder failed: ${String(error)}` });
	}
	return json(200, { ok: true, root: options.root });
}

/**
 * Answer one discard request: drop saved copies by draft id or text digest.
 * @param request - the buffered POST request.
 * @param store - the draft store.
 * @returns the JSON response.
 */
async function handleDiscard(request, store) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, message: "request body must be JSON" });
	}
	const draftIds = Array.isArray(payload?.draftIds) ? payload.draftIds.filter((id) => typeof id === "string") : [];
	const hashes = Array.isArray(payload?.hashes) ? payload.hashes.filter((hash) => typeof hash === "string") : [];
	const removed = await store.discard({ draftIds, hashes });
	return json(200, { ok: true, removed, ...(await store.counts()) });
}

/**
 * Append one client diagnostic line to `probe.log` (verification aid).
 * @param request - the buffered POST request.
 * @param options - resolved plugin options.
 * @returns the JSON response.
 */
async function handleProbe(request, options) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		payload = {};
	}
	const line = `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`;
	try {
		await mkdir(options.root, { recursive: true });
		await writeFile(join(options.root, "probe.log"), line, { encoding: "utf8", flag: "a" });
	} catch {
		/* The probe is a diagnostic; its failure must never reach the user. */
	}
	return json(200, { ok: true });
}

/**
 * Extract the durable image ids and text digests from one committed user message.
 * @param event - the committed session event.
 * @returns image attachment ids and candidate text digests.
 */
function committedContent(event) {
	const content = Array.isArray(event?.data?.content) ? event.data.content : [];
	const imageIds = [];
	/* Named apart from the textHashes() helper: shadowing it made every message
	 * that carried text throw before cleanup. */
	const textDigests = [];
	let combined = "";
	for (const part of content) {
		if (part?.type === "image") {
			const attachmentId = part.attachment?.attachmentId;
			if (typeof attachmentId === "string" && attachmentId !== "") imageIds.push(attachmentId);
			continue;
		}
		if (part?.type !== "text" || typeof part.text !== "string") continue;
		const text = normalizeNewlines(part.text);
		combined += text;
		for (const hash of textHashes(text)) textDigests.push(hash);
	}
	if (combined !== "" && content.filter((part) => part?.type === "text").length > 1) {
		for (const hash of textHashes(combined)) textDigests.push(hash);
	}
	return { imageIds, textHashes: textDigests };
}

/**
 * Count distinct text drafts: one text copied across Sessions is still one draft.
 * @param entries - stored entries.
 * @returns the distinct-text count.
 */
function countDistinctTexts(entries) {
	const seen = new Set();
	for (const entry of entries) {
		if (entry.kind === "text") seen.add(entry.trimmedHash ?? entry.hash);
	}
	return seen.size;
}

/**
 * Durable index over saved drafts, serialized behind one write chain.
 */
class DraftStore {
	/**
	 * @param root - absolute storage root.
	 * @param logger - host logger, when present.
	 */
	constructor(root, logger) {
		this.root = root;
		this.logger = logger;
		this.entries = null;
		this.chain = Promise.resolve();
	}

	/** @returns the absolute index path. */
	indexPath() {
		return join(this.root, INDEX_NAME);
	}

	/** Load the index once, tolerating a missing file. */
	async ensure() {
		if (this.entries !== null) return;
		try {
			const raw = await readFile(this.indexPath(), "utf8");
			const parsed = JSON.parse(raw);
			this.entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(isStoredEntry) : [];
		} catch (error) {
			if (error?.code !== "ENOENT") this.warn(`reading the index failed: ${String(error)}`);
			this.entries = [];
		}
	}

	/** @returns detached copies of the stored entries. */
	async snapshot() {
		await this.ensure();
		return this.entries.slice();
	}

	/** @returns the image/text entry counts. */
	async counts() {
		await this.ensure();
		let images = 0;
		for (const entry of this.entries) {
			if (entry.kind === "image") images += 1;
		}
		return { images, texts: countDistinctTexts(this.entries), count: this.entries.length };
	}

	/**
	 * One stored image entry by draft identity.
	 * @param draftId - browser draft id.
	 * @param sessionId - owning session id.
	 * @returns the entry, when present.
	 */
	async findImage(draftId, sessionId) {
		await this.ensure();
		return this.entries.find((entry) => entry.kind === "image" && entry.draftId === draftId && entry.sessionId === sessionId);
	}

	/**
	 * Serialize one mutation over the current entries.
	 * @param task - mutation receiving the live entry array.
	 * @returns the task's result.
	 */
	serialize(task) {
		const run = this.chain.then(async () => {
			await this.ensure();
			return task();
		});
		this.chain = run.then(() => undefined, () => undefined);
		return run;
	}

	/** Persist the current entries atomically. */
	async persist() {
		await mkdir(this.root, { recursive: true });
		const temp = `${this.indexPath()}.tmp`;
		await writeFile(temp, JSON.stringify({ version: 2, entries: this.entries }), "utf8");
		await rename(temp, this.indexPath());
	}

	/**
	 * Append one entry (idempotent for the same draft identity).
	 * @param entry - the stored entry.
	 * @returns the resulting counts.
	 */
	async add(entry) {
		return this.serialize(async () => {
			if (entry.kind === "image" && this.entries.some((current) => current.kind === "image" && current.draftId === entry.draftId && current.sessionId === entry.sessionId)) {
				return this.countsSync();
			}
			this.entries.push(entry);
			await this.persist();
			return this.countsSync();
		});
	}

	/**
	 * Replace the stored text draft of one session.
	 * @param sessionId - owning session id.
	 * @param text - normalized draft text.
	 * @param options - resolved plugin options (unused, kept for signature symmetry).
	 * @returns the digest, file path, and resulting counts.
	 */
	async putText(sessionId, text, options) {
		void options;
		const hashes = textHashes(text);
		const relative = join("texts", `${safeSegment(sessionId)}.txt`);
		const absolute = join(this.root, relative);
		return this.serialize(async () => {
			const previous = this.entries.find((entry) => entry.kind === "text" && entry.sessionId === sessionId);
			const entry = {
				kind: "text",
				sessionId,
				hash: hashes[0],
				trimmedHash: hashes[1],
				text,
				savedAt: Date.now(),
				file: relative
			};
			if (previous !== undefined && previous.file !== relative) await this.removeFile(previous);
			this.entries = this.entries.filter((current) => !(current.kind === "text" && current.sessionId === sessionId));
			this.entries.push(entry);
			await mkdir(dirname(absolute), { recursive: true });
			await writeFile(absolute, text, "utf8");
			await this.persist();
			return { hash: hashes[0], path: absolute, counts: this.countsSync() };
		});
	}

	/**
	 * Remove every copy whose content identity a committed message carries.
	 * @param attachmentIds - committed `sha256:` image ids.
	 * @param hashes - candidate committed text digests.
	 * @returns how many copies were removed.
	 */
	async removeCommitted(attachmentIds, hashes) {
		const imageIds = new Set(attachmentIds);
		const textDigests = new Set(hashes);
		return this.serialize(async () => {
			let removed = 0;
			const keep = [];
			for (const entry of this.entries) {
				const matched = entry.kind === "image"
					? imageIds.has(entry.attachmentId)
					: textDigests.has(entry.hash) || textDigests.has(entry.trimmedHash);
				if (matched) {
					removed += 1;
					await this.removeFile(entry);
				} else {
					keep.push(entry);
				}
			}
			if (removed > 0) {
				this.entries = keep;
				await this.persist();
			}
			return removed;
		});
	}

	/**
	 * Remove copies by browser draft id or text digest.
	 * @param request - draft ids and text digests to drop.
	 * @returns how many copies were removed.
	 */
	async discard(request) {
		const draftIds = new Set(request.draftIds);
		const hashes = new Set(request.hashes);
		return this.serialize(async () => {
			let removed = 0;
			const keep = [];
			for (const entry of this.entries) {
				const matched = entry.kind === "image"
					? draftIds.has(entry.draftId)
					: hashes.has(entry.hash) || hashes.has(entry.trimmedHash);
				if (matched) {
					removed += 1;
					await this.removeFile(entry);
				} else {
					keep.push(entry);
				}
			}
			if (removed > 0) {
				this.entries = keep;
				await this.persist();
			}
			return removed;
		});
	}

	/**
	 * Drop copies older than a retention window.
	 * @param days - retention in days.
	 */
	async pruneOlderThan(days) {
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		await this.serialize(async () => {
			const keep = [];
			for (const entry of this.entries) {
				if (entry.savedAt < cutoff) await this.removeFile(entry);
				else keep.push(entry);
			}
			if (keep.length !== this.entries.length) {
				this.entries = keep;
				await this.persist();
			}
		});
	}

	/** @returns the image/text entry counts synchronously. */
	countsSync() {
		let images = 0;
		for (const entry of this.entries) {
			if (entry.kind === "image") images += 1;
		}
		return { images, texts: countDistinctTexts(this.entries), count: this.entries.length };
	}

	/**
	 * Delete one stored file, never escaping the storage root.
	 * @param entry - the entry whose file is deleted.
	 */
	async removeFile(entry) {
		const absolute = this.absolutePath(entry.file);
		if (absolute === undefined) return;
		try {
			await unlink(absolute);
		} catch (error) {
			if (error?.code !== "ENOENT") this.warn(`removing "${absolute}" failed: ${String(error)}`);
		}
	}

	/**
	 * Resolve one stored relative file inside the storage root.
	 * @param relative - stored relative path.
	 * @returns the absolute path, or undefined when it escapes the root.
	 */
	absolutePath(relative) {
		if (typeof relative !== "string" || relative === "") return undefined;
		const absolute = resolve(this.root, relative);
		const prefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
		return absolute === this.root || absolute.startsWith(prefix) ? absolute : undefined;
	}

	/**
	 * Log one store warning without throwing.
	 * @param message - diagnostic text.
	 */
	warn(message) {
		try {
			this.logger?.warn?.(`unsent-content-guard: ${message}`);
		} catch {
			/* Logging is best-effort. */
		}
	}
}

/**
 * Validate one deserialized index entry.
 * @param entry - candidate value.
 * @returns whether it is a stored entry this build understands.
 */
function isStoredEntry(entry) {
	if (entry === null || typeof entry !== "object") return false;
	if (typeof entry.sessionId !== "string" || !ID_PATTERN.test(entry.sessionId)) return false;
	if (typeof entry.savedAt !== "number" || typeof entry.file !== "string") return false;
	if (entry.kind === "image") {
		return typeof entry.draftId === "string" && ID_PATTERN.test(entry.draftId) && typeof entry.attachmentId === "string";
	}
	if (entry.kind === "text") {
		return typeof entry.hash === "string" && typeof entry.trimmedHash === "string" && typeof entry.text === "string";
	}
	return false;
}

/**
 * Keep a display name a single safe path segment.
 * @param value - client-provided name.
 * @param extension - fallback media extension.
 * @returns the sanitized name.
 */
function safeDisplayName(value, extension) {
	const leaf = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1);
	const cleaned = leaf.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/u, "").slice(0, 120);
	return cleaned === "" ? `image.${extension}` : cleaned;
}

/**
 * Keep one id a single safe path segment.
 * @param value - validated id.
 * @returns the path-safe segment.
 */
function safeSegment(value) {
	return value.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 160);
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
 * Opt-in verification: drive the real route handlers in-process and record the
 * evidence next to the storage root. Enabled only by `config.selfTest`.
 * @param ctx - Host plugin context.
 * @param store - the draft store.
 * @param options - resolved plugin options.
 */
async function runSelfTest(ctx, store, options) {
	const results = [];
	const check = (step, ok, detail) => results.push({ step, ok: ok === true, detail: detail === undefined ? "" : String(detail) });
	const request = (path, body) => new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	try {
		await store.ensure();
		const before = await store.counts();
		const savedImage = await (await handleSaveImage(ctx, request(SAVE_IMAGE_PATH, {
			sessionId: "session-selftest",
			draftId: "selftest-image",
			name: "selftest.png",
			mediaType: "image/png",
			data: SELFTEST_PNG.toString("base64")
		}), store, options)).json();
		check("image-save", savedImage.ok === true && savedImage.images === 1, JSON.stringify(savedImage));

		const readBack = await (await handleReadImage(ctx, request(READ_IMAGE_PATH, { draftId: "selftest-image" }), store)).json();
		check("image-read", readBack.ok === true && readBack.data === SELFTEST_PNG.toString("base64"), `bytes=${String(readBack.bytes)}`);

		const savedText = await (await handleSaveText(request(SAVE_TEXT_PATH, {
			sessionId: "session-selftest",
			text: "自检：这条文字没有发送"
		}), store, options)).json();
		check("text-save", savedText.ok === true && savedText.texts === 1, JSON.stringify(savedText));

		const replaced = await (await handleSaveText(request(SAVE_TEXT_PATH, {
			sessionId: "session-selftest",
			text: "自检：这条文字没有发送（已修改）"
		}), store, options)).json();
		check("text-replace", replaced.texts === 1 && replaced.hash !== savedText.hash, JSON.stringify({ before: savedText.hash, after: replaced.hash }));

		const listed = await (await handleList(store, options)).json();
		check("list", listed.images === 1 && listed.texts === 1, JSON.stringify({ images: listed.images, texts: listed.texts }));

		const duplicate = await (await handleSaveImage(ctx, request(SAVE_IMAGE_PATH, {
			sessionId: "session-selftest",
			draftId: "selftest-image",
			name: "selftest.png",
			mediaType: "image/png",
			data: SELFTEST_PNG.toString("base64")
		}), store, options)).json();
		check("image-idempotent", duplicate.duplicate === true, JSON.stringify(duplicate));

		const committedRemoved = await store.removeCommitted([savedImage.attachmentId], [replaced.hash, replaced.trimmedHash]);
		check("commit-delete", committedRemoved === 2, `removed=${String(committedRemoved)}`);

		const restoredText = await (await handleSaveText(request(SAVE_TEXT_PATH, {
			sessionId: "session-selftest",
			text: "自检：待丢弃"
		}), store, options)).json();
		const discarded = await (await handleDiscard(request(DISCARD_PATH, { hashes: [restoredText.hash] }), store)).json();
		check("discard", discarded.ok === true && discarded.removed === 1, JSON.stringify(discarded));

		const final = await store.counts();
		check("restore-clean", final.images === before.images && final.texts === before.texts, JSON.stringify(final));
	} catch (error) {
		check("fatal", false, error?.stack ?? String(error));
	}
	try {
		await mkdir(options.root, { recursive: true });
		await writeFile(join(options.root, "selftest.json"), JSON.stringify({
			at: new Date().toISOString(),
			passed: results.filter((result) => result.ok).length,
			failed: results.filter((result) => !result.ok).length,
			results
		}, null, 2), "utf8");
	} catch (error) {
		ctx.logger?.warn(`unsent-content-guard: writing self-test evidence failed: ${String(error)}`);
	}
}
