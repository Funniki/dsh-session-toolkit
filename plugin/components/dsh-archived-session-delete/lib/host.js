/**
 * Host half of the archived-Session delete feature.
 *
 * DSH has no deletion or retention API: `@deepseek-ai/dsh-session-persistence`
 * documents pruning stored Sessions as out-of-band backend maintenance, and the
 * workspace registry only archives and unarchives. This plugin owns that
 * out-of-band deletion for exactly one Session at a time, behind the
 * authenticated `/api` carrier, so the browser half can offer it from an
 * archived row's "..." menu.
 *
 * Deleting one archived Session means, in order:
 *
 * 1. `workspace/session-stop` is asked to stop the Session's running turn,
 *    jobs, schedule reminders, and subagent descendants, and the
 *    `workspace/session-activity` waterfall is polled until it reports nothing.
 *    A Session that will not quiesce is refused instead of deleted: a running
 *    turn must not append into a log that is about to disappear.
 * 2. If the Session is still live in this process — archiving keeps it in the
 *    Session store — it is flushed (draining every buffered event durably) and
 *    then detached through the store's own public inverse of `enter`, which
 *    emits `session/disposed`: the persistence write path runs its final drain
 *    and releases the write handle, and the Session leaves `sessions.list()`
 *    so it cannot reappear as a row after a page reload.
 * 3. The stored artifact directory is removed from the persistence root: the
 *    JSONL backend writes one directory per Session under
 *    `<root>/<project>/<sessionId>/`, resolved here from the mounted backend's
 *    own configured root so no layout knowledge is duplicated.
 * 4. The Session is detached from every Workspace's accounting and dropped from
 *    the registry's pin and archive sets, so no id survives pointing at a
 *    deleted Session.
 * 5. `api-session/removed` is emitted, the forwarded event every open page
 *    already uses to drop a Session from its list.
 *
 * Attachments stay: they are content-addressed and may be referenced by other
 * Sessions or files. Spilled tool results stay too; the spill backend expires
 * them on its own retention schedule.
 *
 * @module dsh-archived-session-delete
 */

import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Stable Cordis plugin name. */
export const name = "archived-session-delete";

/** The authenticated Fetch carrier that serves the delete route. */
export const inject = ["connection"];

/** Absolute pathname the Host registers the deletion route under. */
export const SESSION_DELETE_PATH = "/api/session.delete";

/** How long a Session may take to quiesce after `workspace/session-stop`, in milliseconds. */
const QUIESCE_TIMEOUT_MS = 8000;

/** Interval between `workspace/session-activity` polls while waiting for quiescence, in milliseconds. */
const QUIESCE_POLL_MS = 150;

/**
 * How long to wait after detaching a live Session before removing its artifact,
 * in milliseconds: the store emits `session/disposed` synchronously while the
 * persistence write path's final drain and handle release settle asynchronously.
 */
const DETACH_SETTLE_MS = 150;

/**
 * Session ids are host-minted, but this feature accepts one from the browser, so
 * it is re-validated before it can shape a path or a durable set: non-empty,
 * bounded, and free of separators, traversal, and control characters.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

/**
 * A refused deletion, carrying the stable code the HTTP layer maps to a status.
 */
export class SessionDeleteRefusal extends Error {
	/**
	 * @param code - stable refusal code.
	 * @param message - the operator-facing explanation.
	 * @param details - extra response fields (for example the reported activity).
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "SessionDeleteRefusal";
		this.code = code;
		Object.assign(this, details);
	}
}

/**
 * Register the deletion route.
 * @param ctx - Host plugin context carrying the Connection service.
 */
export function apply(ctx) {
	const connection = ctx.get("connection");
	if (connection === undefined) return;
	ctx.effect(() => connection.fetch.register({
		path: SESSION_DELETE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => sessionDeleteResponse(ctx, request)
	}), "archived-session-delete: delete route");
}

/**
 * Answer one deletion request.
 * @param ctx - Host plugin context.
 * @param request - the buffered POST request.
 * @returns the JSON response.
 */
export async function sessionDeleteResponse(ctx, request) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { error: "bad-request", message: "request body must be JSON" });
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
	try {
		return json(200, await deleteArchivedSession(ctx, sessionId));
	} catch (error) {
		if (error instanceof SessionDeleteRefusal) return json(refusalStatus(error.code), {
			error: error.code,
			message: error.message,
			...error.activity === undefined ? {} : { activity: error.activity },
			...error.detachedLive === undefined ? {} : { detachedLive: error.detachedLive }
		});
		ctx.logger?.warn(`archived-session-delete: deleting session "${sessionId}" failed: ${String(error)}`);
		return json(500, {
			error: "delete-failed",
			message: `deleting the Session failed: ${errorMessage(error)}`
		});
	}
}

/**
 * The HTTP status for one refusal code.
 * @param code - the refusal code.
 * @returns the status code.
 */
function refusalStatus(code) {
	switch (code) {
		case "bad-request": return 400;
		case "not-archived":
		case "session-active": return 409;
		default: return 500;
	}
}

/**
 * Permanently delete one archived Session: quiesce it, release it from the live
 * store, remove its durable artifacts, forget its workspace accounting, and
 * tell every open page it is gone.
 * @param ctx - Host plugin context.
 * @param sessionId - the archived Session id to delete.
 * @returns the deletion receipt.
 * @throws {SessionDeleteRefusal} when the request is refused.
 */
export async function deleteArchivedSession(ctx, sessionId) {
	if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
		throw new SessionDeleteRefusal("bad-request", "sessionId must be a Session id");
	}
	const registry = ctx.get("workspaceRegistry");
	if (registry === undefined) throw new SessionDeleteRefusal("unavailable", "the workspace registry is not mounted");
	if (!registry.archivedSessionIds.includes(sessionId)) {
		throw new SessionDeleteRefusal("not-archived", "only an archived Session can be deleted from this menu");
	}

	await quiesceSession(ctx, sessionId);

	const sessions = ctx.get("sessions");
	let detachedLive = false;
	if (sessions !== undefined) {
		const live = sessions.get(sessionId);
		if (live !== undefined) {
			try {
				await sessions.flush(live);
				sessions.detachEntered(sessions.liveEntryFor(live));
				detachedLive = true;
				await delay(DETACH_SETTLE_MS);
			} catch (error) {
				throw new SessionDeleteRefusal(
					"session-live",
					`the Session is live in this process and could not be released: ${errorMessage(error)}`,
					{ detachedLive }
				);
			}
		}
	}

	let removed;
	try {
		removed = await removeStoredSession(ctx, sessionId);
	} catch (error) {
		throw new SessionDeleteRefusal(
			"delete-failed",
			`removing the stored Session failed: ${errorMessage(error)}`,
			{ detachedLive }
		);
	}

	await forgetWorkspaceAccounting(ctx, registry, sessionId);
	ctx.emit("api-session/removed", sessionId);

	return {
		sessionId,
		removed,
		detachedLive
	};
}

/**
 * Ask every `workspace/session-stop` provider to stop the Session's work and
 * wait until the activity waterfall reports nothing left.
 * @param ctx - Host plugin context.
 * @param sessionId - the Session to quiesce.
 * @throws {SessionDeleteRefusal} while the Session still reports activity.
 */
async function quiesceSession(ctx, sessionId) {
	try {
		await ctx.parallel("workspace/session-stop", { sessionId });
	} catch (error) {
		/* A failing stop request is not a reason to keep the Session: the archive
		 * flow treats the same refusal as a warning, and the activity poll below
		 * still decides whether anything is left running. */
		ctx.logger?.warn(`archived-session-delete: stopping session "${sessionId}" reported: ${String(error)}`);
	}
	const deadline = Date.now() + QUIESCE_TIMEOUT_MS;
	for (;;) {
		let activity;
		try {
			activity = await ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
		} catch (error) {
			ctx.logger?.warn(`archived-session-delete: reading session activity for "${sessionId}" failed: ${String(error)}`);
			return;
		}
		if (activity.length === 0) return;
		if (Date.now() >= deadline) {
			throw new SessionDeleteRefusal(
				"session-active",
				`the Session is still active (${activity.map((entry) => entry?.kind ?? "activity").join(", ")}); stop that work and try again`,
				{ activity }
			);
		}
		await delay(QUIESCE_POLL_MS);
	}
}

/**
 * Remove the Session's durable artifacts: its stored log directory under the
 * mounted persistence backend's root, and the projection cache file the
 * storage unit keeps under the Session id (best effort).
 * @param ctx - Host plugin context.
 * @param sessionId - the Session whose artifacts are removed.
 * @returns the absolute paths removed.
 */
async function removeStoredSession(ctx, sessionId) {
	const removed = [];
	const root = resolveSessionsRoot(ctx);
	for (const project of await listDirectories(root)) {
		const dir = join(root, project, sessionId);
		if (await isDirectory(dir)) {
			await rm(dir, { recursive: true, force: true });
			removed.push(dir);
		}
	}
	/* A flat artifact directly under the root is a layout the shipped backend
	 * rejects, but a foreign backend could still own it; remove it when present. */
	for (const candidate of [join(root, sessionId), join(root, `${sessionId}.jsonl`), join(root, `${sessionId}.jsonl.zstd`)]) {
		if (await pathExists(candidate)) {
			await rm(candidate, { recursive: true, force: true });
			removed.push(candidate);
		}
	}
	const projections = join(resolveDshHome(), "storages", "session_projcache", "sessions", `${sessionId}.json`);
	try {
		if (await pathExists(projections)) {
			await rm(projections, { force: true });
			removed.push(projections);
		}
	} catch (error) {
		ctx.logger?.warn(`archived-session-delete: removing the projection cache for "${sessionId}" failed: ${String(error)}`);
	}
	return removed;
}

/**
 * Drop every durable reference to the Session: its Workspace accounting slot,
 * its pin, and its archive-set membership. Each call is idempotent and writes
 * nothing when the id is already absent.
 * @param ctx - Host plugin context.
 * @param registry - the mounted workspace registry.
 * @param sessionId - the deleted Session id.
 */
async function forgetWorkspaceAccounting(ctx, registry, sessionId) {
	for (const workspace of registry.list()) {
		try {
			await workspace.detachSession(sessionId);
		} catch (error) {
			ctx.logger?.warn(`archived-session-delete: detaching session "${sessionId}" from workspace "${workspace.id}" failed: ${String(error)}`);
		}
	}
	for (const step of [
		() => registry.unpinSession(sessionId),
		() => registry.unarchiveSession(sessionId)
	]) {
		try {
			await step();
		} catch (error) {
			ctx.logger?.warn(`archived-session-delete: forgetting archival state for "${sessionId}" failed: ${String(error)}`);
		}
	}
}

/**
 * The mounted persistence backend's own root, falling back to the documented
 * harness home layout when that backend exposes none.
 * @param ctx - Host plugin context.
 * @returns the absolute sessions root.
 */
function resolveSessionsRoot(ctx) {
	const persistence = ctx.get("sessionPersistence");
	const fromService = persistence?.root;
	if (typeof fromService === "string" && fromService.length > 0) return resolve(fromService);
	const fromConfig = persistence?.config?.root;
	if (typeof fromConfig === "string" && fromConfig.length > 0) return resolve(fromConfig);
	return join(resolveDshHome(), "sessions");
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
 * Read the immediate child directory names of one root.
 * @param root - the directory to scan.
 * @returns its directory entry names; an absent root yields an empty list.
 */
async function listDirectories(root) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * Whether one path is an existing directory.
 * @param path - the absolute path to inspect.
 * @returns whether it exists and is a directory.
 */
async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Whether one path exists at all.
 * @param path - the absolute path to inspect.
 * @returns whether it exists.
 */
async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Sleep for one bounded interval.
 * @param ms - milliseconds to wait.
 * @returns a promise resolved after the interval.
 */
function delay(ms) {
	return new Promise((resolved) => {
		setTimeout(resolved, ms);
	});
}

/**
 * One JSON response.
 * @param status - the HTTP status code.
 * @param body - the JSON-serializable body.
 * @returns the response.
 */
function json(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" }
	});
}

/**
 * One error's message.
 * @param error - the caught value.
 * @returns its message text.
 */
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
