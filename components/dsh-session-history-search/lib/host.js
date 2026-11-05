/**
 * Session History Search — keyword search across conversation messages.
 *
 * DSH's shipped composition disables the FTS5 backend by default
 * (`session-query-sqlite` is mounted with `openAt: never`), and FTS5's
 * `unicode61` tokenizer cannot segment Chinese text, so the built-in sidebar
 * search cannot find a Chinese word inside a continuous sentence.
 *
 * This plugin searches with a literal, case-insensitive substring scan over
 * the current surface of user/assistant messages (`sessionQuery.filterEvents`
 * with a `text` clause), which works for Chinese as-is. Message text is cached
 * per session keyed by the persistence revision, so the first search pays the
 * log-read cost and later searches are cheap.
 *
 * @module dsh-session-history-search
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export const name = "session-history-search";
export const inject = ["connection"];
export const SEARCH_PATH = "/api/session-search/query";
export const PROBE_PATH = "/api/session-search/probe";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const MAX_SESSIONS = 400;
const SNIPPET_BEFORE = 48;
const SNIPPET_AFTER = 96;

/** `$DSH_HOME/session-history-search`. */
function dataDir() {
	const configured = (process.env.DSH_HOME ?? "").trim();
	return join(configured.length > 0 ? configured : join(homedir(), ".dsh"), "session-history-search");
}

function json(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Mount the search routes and the optional self-test.
 * @param ctx - Host plugin context.
 * @param config - raw row config (`selfTest`, `selfTestQuery`).
 */
export function apply(ctx, config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const connection = ctx.get("connection");
	if (connection === undefined) return;
	ctx.effect(() => connection.fetch.register({
		path: SEARCH_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => searchResponse(ctx, request)
	}), "session-history-search: query route");
	ctx.effect(() => connection.fetch.register({
		path: PROBE_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: (request) => probeResponse(request)
	}), "session-history-search: probe route");
	if (raw.selfTest === true) {
		const timer = setTimeout(() => {
			runSelfTest(ctx, raw).catch(() => {});
		}, 2500);
		ctx.effect(() => () => clearTimeout(timer), "session-history-search: self-test timer");
	}
}

/** Per-session message cache: sessionId -> { revision, messages }. */
const messageCache = new Map();

/**
 * Read (and cache) every current-surface user/assistant message of one session.
 * @param ctx - Host plugin context.
 * @param sessionId - session id.
 * @param revision - persistence revision the listing observed.
 * @returns the cached message list.
 */
async function messagesOf(ctx, sessionId, revision) {
	const cached = messageCache.get(sessionId);
	if (cached !== undefined && cached.revision === revision) return cached.messages;
	const sessionQuery = ctx.get("sessionQuery");
	if (sessionQuery === undefined) throw new Error("sessionQuery is unavailable");
	const documents = await sessionQuery.filterEvents(sessionId, [
		{ kind: "type", values: ["user/message", "assistant/message"] },
		{ kind: "surface", values: ["current"] }
	]);
	const messages = [];
	let turn = 0;
	for (const document of documents) {
		if (document.type === "user/message") turn += 1;
		messages.push({
			seq: document.seq,
			time: document.time,
			type: document.type,
			turn: Math.max(1, turn),
			text: typeof document.text === "string" ? document.text : String(document.text ?? "")
		});
	}
	messageCache.set(sessionId, { revision, messages });
	return messages;
}

/**
 * Build one snippet around a match.
 * @param text - full message text.
 * @param index - match index.
 * @param length - query length.
 * @returns the snippet with ellipses.
 */
function snippetAround(text, index, length) {
	const start = Math.max(0, index - SNIPPET_BEFORE);
	const end = Math.min(text.length, index + length + SNIPPET_AFTER);
	return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Run one substring search over the visible corpus.
 * @param ctx - Host plugin context.
 * @param queryText - literal query (Chinese supported).
 * @param limit - maximum returned hits.
 * @returns the search payload.
 */
async function search(ctx, queryText, limit) {
	const started = Date.now();
	const sessionQuery = ctx.get("sessionQuery");
	const persistence = ctx.get("sessionPersistence");
	if (sessionQuery === undefined || persistence === undefined) {
		throw new Error("session search is unavailable: sessionQuery/sessionPersistence missing");
	}
	const snapshots = await persistence.list();
	const candidates = snapshots
		.filter((snapshot) => typeof snapshot.header?.cwd === "string" && snapshot.header.cwd.length > 0 && snapshot.header.origin !== "subagent" && snapshot.formatStatus !== "migration-required")
		.sort((left, right) => right.header.createdAt - left.header.createdAt)
		.slice(0, MAX_SESSIONS);
	const needle = queryText.toLowerCase();
	const hits = [];
	let scanned = 0;
	let indexed = 0;
	for (const snapshot of candidates) {
		let messages;
		try {
			messages = await messagesOf(ctx, snapshot.header.id, String(snapshot.revision));
		} catch {
			continue;
		}
		scanned += 1;
		indexed += messages.length;
		for (const message of messages) {
			const index = message.text.toLowerCase().indexOf(needle);
			if (index < 0) continue;
			hits.push({
				sessionId: String(snapshot.header.id),
				cwd: snapshot.header.cwd,
				seq: message.seq,
				turn: message.turn,
				time: message.time,
				role: message.type === "user/message" ? "user" : "assistant",
				snippet: snippetAround(message.text, index, queryText.length)
			});
			if (hits.length >= limit * 6) break;
		}
	}
	hits.sort((left, right) => right.time - left.time);
	const capped = hits.slice(0, limit);
	const titles = new Map();
	if (capped.length > 0) {
		try {
			const ids = [...new Set(capped.map((hit) => hit.sessionId))];
			const observed = await sessionQuery.readTitleSnapshots(ids);
			for (const result of observed) {
				if (result.status === "fulfilled") titles.set(String(result.sessionId), result.value.title?.title);
			}
		} catch {
			/* titles are optional decoration */
		}
	}
	return {
		ok: true,
		query: queryText,
		items: capped.map((hit) => ({
			...hit,
			title: titles.get(hit.sessionId) ?? basename(hit.cwd) ?? "未命名会话"
		})),
		hasMore: hits.length > capped.length,
		scannedSessions: scanned,
		scannedMessages: indexed,
		tookMs: Date.now() - started
	};
}

/**
 * Answer one search request.
 * @param ctx - Host plugin context.
 * @param request - buffered POST body `{ query, limit? }`.
 * @returns the JSON response.
 */
async function searchResponse(ctx, request) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		return json(400, { ok: false, message: "request body must be JSON" });
	}
	const queryText = typeof payload?.query === "string" ? payload.query.trim() : "";
	if (queryText.length === 0) return json(400, { ok: false, message: "query must not be empty" });
	if (queryText.length > 200) return json(400, { ok: false, message: "query is too long" });
	const rawLimit = Number(payload?.limit);
	const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(rawLimit)) : DEFAULT_LIMIT;
	try {
		return json(200, await search(ctx, queryText, limit));
	} catch (error) {
		return json(500, { ok: false, message: String(error?.message ?? error) });
	}
}

/**
 * Append one client diagnostic line to `probe.log`.
 * @param request - buffered POST request.
 * @returns the JSON response.
 */
async function probeResponse(request) {
	let payload;
	try {
		payload = await request.json();
	} catch {
		payload = {};
	}
	try {
		mkdirSync(dataDir(), { recursive: true });
		appendFileSync(join(dataDir(), "probe.log"), `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`);
	} catch {
		/* diagnostics are best effort */
	}
	return json(200, { ok: true });
}

/**
 * Opt-in startup self-test: run a Chinese and an ASCII query through the same
 * search path and record the evidence.
 * @param ctx - Host plugin context.
 * @param config - raw row config.
 */
async function runSelfTest(ctx, config) {
	const results = [];
	const queries = [String(config.selfTestQuery ?? "会话"), "session"];
	for (const queryText of queries) {
		try {
			const result = await search(ctx, queryText, 5);
			results.push({
				query: queryText,
				ok: true,
				hits: result.items.length,
				scannedSessions: result.scannedSessions,
				scannedMessages: result.scannedMessages,
				tookMs: result.tookMs,
				sample: result.items.slice(0, 3).map((item) => ({ title: item.title, role: item.role, turn: item.turn, seq: item.seq, snippet: item.snippet.slice(0, 160) }))
			});
		} catch (error) {
			results.push({ query: queryText, ok: false, error: String(error?.message ?? error) });
		}
	}
	try {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(join(dataDir(), "selftest.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
	} catch {
		/* evidence is best effort */
	}
}
