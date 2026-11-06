window.__ModuleLoader__.load({
	id: "@funniki/dsh-session-toolkit-session-history-search",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		let clientStore = require("@deepseek-ai/dsh-client-store");
		//#region lib/types/client/styles.js
		const CSS = [
			".shs_backdrop{position:fixed;inset:0;z-index:60;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px;background:rgba(0,0,0,.32)}",
			".shs_panel{box-sizing:border-box;display:flex;flex-direction:column;width:min(680px,92vw);max-height:70vh;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;color:var(--dsw-alias-label-primary)}",
			".shs_head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:.5px solid var(--dsw-alias-border-l1)}",
			".shs_input{box-sizing:border-box;flex:1;min-width:0;font:inherit;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);background:transparent;border:none;outline:none;padding:4px 0}",
			".shs_hint{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".shs_body{min-height:96px;overflow:auto;padding:8px 10px 12px}",
			".shs_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:8px 4px 0}",
			".shs_list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}",
			".shs_item{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;font:inherit;color:inherit;background:0 0;border:.5px solid transparent;border-radius:8px;padding:8px 10px;cursor:pointer}",
			".shs_item:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}",
			".shs_itemHead{display:flex;align-items:center;gap:8px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
			".shs_itemTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".shs_badge{flex:none;font-size:11px;line-height:15px;padding:0 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}",
			".shs_badge_user{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
			".shs_time{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary)}",
			".shs_snippet{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}",
			".shs_mark{background:rgba(255,196,0,.35);color:inherit;border-radius:2px;padding:0 1px}",
			".shs_dock{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;border-radius:var(--dsw-radius-sm);max-width:100%;font:inherit;font-size:12px;line-height:inherit;white-space:nowrap;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;padding:1px 8px;cursor:pointer}",
			".shs_dock:hover{color:var(--dsw-alias-label-primary)}",
			".shs_headBtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}",
			".shs_headBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".shs_view{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;padding:14px 18px 18px;gap:10px;overflow:auto;color:var(--dsw-alias-label-primary)}",
			".shs_viewHead{display:flex;align-items:center;gap:10px;padding-bottom:2px}",
			".shs_viewInput{box-sizing:border-box;flex:1;min-width:0;font:inherit;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:6px 10px}",
			".shs_viewInput:focus{border-color:var(--dsw-alias-brand-primary)}",
			".shs_viewSubmit{flex:none;display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;line-height:18px;padding:5px 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer}",
			".shs_viewSubmit:disabled{opacity:.55;cursor:default}",
			".shs_empty{display:flex;align-items:center;justify-content:center;height:88px;font-size:12px;color:var(--dsw-alias-label-tertiary)}"
		].join("");
		const CSS_TAG_ID = "dsh-session-history-search/Styles.module.css";
		if (typeof document !== "undefined") {
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`);
			if (existing === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-session-history-search";
				tag.dataset.pluginCss = CSS_TAG_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} else if (existing.textContent !== CSS) existing.textContent = CSS;
		}
		//#endregion
		//#region lib/types/client/api.js
		const SEARCH_ROUTE = "/api/session-search/query".slice(1);
		const PROBE_ROUTE = "/api/session-search/probe".slice(1);
		async function postJson(route, body) {
			const response = await fetch(route, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null) throw new Error(typeof parsed?.message === "string" ? parsed.message : `HTTP ${response.status}`);
			return parsed;
		}
		//#endregion
		//#region lib/types/client/locales.js
		const NS = "session-history-search";
		const zh = {
			"dock.label": "搜索历史",
			"page.title": "搜索历史消息",
			"page.hint": "中文可直接搜 · Esc 关闭",
			"search.placeholder": "输入关键词后回车开始搜索…",
			"search.hintIdle": "输入关键词后回车开始搜索",
			"search.loading": "正在检索历史消息…",
			"search.empty": "没有匹配的历史消息",
			"search.count": "命中 {n} 条（扫描 {sessions} 个会话 / {messages} 条消息，用时 {ms} ms）",
			"search.more": "仅显示前 {n} 条，请缩小关键词范围。",
			"search.error": "搜索失败：{message}",
			"role.user": "我",
			"role.assistant": "助手",
			"view.label": "搜索历史",
			"view.hint": "中文可直接搜",
			"view.submit": "搜索"
		};
		const en = {
			"dock.label": "Search history",
			"page.title": "Search past messages",
			"page.hint": "Chinese supported · Esc closes",
			"search.placeholder": "Type a keyword and press Enter to search…",
			"search.hintIdle": "Type a keyword and press Enter",
			"search.loading": "Searching message history…",
			"search.empty": "No matching history messages",
			"search.count": "{n} hits (scanned {sessions} sessions / {messages} messages in {ms} ms)",
			"search.more": "Showing the first {n} hits; narrow the keyword.",
			"search.error": "Search failed: {message}",
			"role.user": "You",
			"role.assistant": "Assistant",
			"view.label": "Search history",
			"view.hint": "Chinese supported",
			"view.submit": "Search"
		};
		//#endregion
		//#region lib/types/client/dialog.js
		function highlightParts(snippet, query) {
			if (query === "") return [{ text: snippet, mark: false }];
			const lowerSnippet = snippet.toLowerCase();
			const lowerQuery = query.toLowerCase();
			const parts = [];
			let cursor = 0;
			while (cursor < snippet.length) {
				const index = lowerSnippet.indexOf(lowerQuery, cursor);
				if (index < 0) {
					parts.push({ text: snippet.slice(cursor), mark: false });
					break;
				}
				if (index > cursor) parts.push({ text: snippet.slice(cursor, index), mark: false });
				parts.push({ text: snippet.slice(index, index + query.length), mark: true });
				cursor = index + query.length;
			}
			return parts;
		}
		function formatTime(time) {
			try {
				return new Date(time).toLocaleString();
			} catch {
				return "";
			}
		}

		/** Poll until predicate returns a non-null value or the timeout elapses. */
		function waitFor(predicate, timeoutMs, intervalMs = 120) {
			return new Promise((resolve) => {
				const started = Date.now();
				const tick = () => {
					const value = predicate();
					if (value !== null && value !== undefined) { resolve(value); return; }
					if (Date.now() - started >= timeoutMs) { resolve(null); return; }
					setTimeout(tick, intervalMs);
				};
				tick();
			});
		}
		/** The turn container rendered by the chat transcript for a 1-based turn number. */
		function turnElement(turn) {
			return document.querySelector('[data-chat-turn="' + turn + '"]');
		}
		/** Click the chat turn-navigation mark of an unloaded turn (it loads through and jumps). */
		function clickRail(turn) {
			const buttons = [...document.querySelectorAll("button[aria-label]")];
			const match = buttons.find((button) => {
				const label = button.getAttribute("aria-label") ?? "";
				const zh = /第\s*(\d+)\s*轮/.exec(label);
				if (zh !== null) return Number(zh[1]) === turn;
				const en = /turn\s*(\d+)/i.exec(label);
				return en !== null ? Number(en[1]) === turn : false;
			});
			if (match === undefined) return false;
			match.click();
			return true;
		}
		/** Flash the element the jump landed on. */
		function flash(element) {
			const previous = { outline: element.style.outline, offset: element.style.outlineOffset, radius: element.style.borderRadius };
			element.style.outline = "2px solid var(--dsw-alias-brand-primary)";
			element.style.outlineOffset = "4px";
			element.style.borderRadius = "10px";
			setTimeout(() => {
				element.style.outline = previous.outline;
				element.style.outlineOffset = previous.offset;
				element.style.borderRadius = previous.radius;
			}, 2600);
		}

		/** Click the chat's "load older" control when it is present. */
		function clickLoadOlder() {
			const buttons = [...document.querySelectorAll("button, [role='button']")];
			const match = buttons.find((element) => {
				const text = (element.textContent ?? "") + " " + (element.getAttribute("aria-label") ?? "");
				return /加载更早|load\s*(older|earlier)/i.test(text);
			});
			if (match === undefined) return false;
			match.click();
			return true;
		}
		/** Best-effort text jump: page history in with the chat's own loader until the message renders. */
		async function jumpByText(needle, maxLoads = 12) {
			if (needle === "") return false;
			const findNode = () => [...document.querySelectorAll("[data-chat-node-key]")].find((element) => (element.textContent ?? "").toLowerCase().includes(needle)) ?? null;
			let node = findNode();
			for (let index = 0; index < maxLoads && node === null; index += 1) {
				if (!clickLoadOlder()) break;
				node = await waitFor(findNode, 1200);
			}
			if (node === null) return false;
			node.scrollIntoView({ block: "center", behavior: "smooth" });
			flash(node);
			return true;
		}
		/**
		 * Open (if needed) the hit session, then scroll the chat to the matched turn and
		 * message. When the transcript already belongs to that session we never re-open
		 * it, so the chat's own paging state (load older) stays intact.
		 */
		async function jumpToHit(item, query, openSession, onClose) {
			const needle = String(query ?? "").toLowerCase();
			const transcript = document.querySelector("[data-chat-turn]");
			const sameSession = transcript !== null && (turnElement(item.turn) !== null
				|| (needle !== "" && [...document.querySelectorAll("[data-chat-node-key]")].some((element) => (element.textContent ?? "").toLowerCase().includes(needle))));
			if (!sameSession) openSession(item.sessionId);
			onClose();
			if (typeof item.turn !== "number") return jumpByText(needle);
			let target = await waitFor(() => turnElement(item.turn), 2200);
			if (target === null && clickRail(item.turn)) target = await waitFor(() => turnElement(item.turn), 6000);
			if (target === null) return jumpByText(needle);
			const nodes = [...target.querySelectorAll("[data-chat-node-key]")];
			const matchNode = needle === "" ? undefined : nodes.find((element) => (element.textContent ?? "").toLowerCase().includes(needle));
			const focus = matchNode ?? target;
			focus.scrollIntoView({ block: "center", behavior: "smooth" });
			flash(focus);
			return true;
		}
		function SearchDockButton({ t, openSearch }) {
			return jsxRuntime.jsxs("button", {
				type: "button",
				className: "shs_dock",
				title: t("dock.label"),
				onClick: () => openSearch(),
				children: [
					jsxRuntime.jsxs("svg", {
						width: 13,
						height: 13,
						viewBox: "0 0 20 20",
						fill: "none",
						"aria-hidden": true,
						children: [
							jsxRuntime.jsx("circle", { cx: 8.8, cy: 8.8, r: 5.2, stroke: "currentColor", strokeWidth: 1.8 }),
							jsxRuntime.jsx("path", { d: "m12.7 12.7 3.6 3.6", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" })
						]
					}),
					jsxRuntime.jsx("span", { children: t("dock.label") })
				]
			});
		}
		function HeaderSearchButton({ t, openSearch }) {
			return jsxRuntime.jsx("button", {
				type: "button",
				className: "shs_headBtn",
				title: t("dock.label") + " · Ctrl+Shift+K",
				"aria-label": t("dock.label"),
				onClick: () => openSearch(),
				children: jsxRuntime.jsxs("svg", {
					width: 15,
					height: 15,
					viewBox: "0 0 20 20",
					fill: "none",
					"aria-hidden": true,
					children: [
						jsxRuntime.jsx("circle", { cx: 8.8, cy: 8.8, r: 5.2, stroke: "currentColor", strokeWidth: 1.8 }),
						jsxRuntime.jsx("path", { d: "m12.7 12.7 3.6 3.6", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" })
					]
				})
			});
		}
		function SearchView(props) {
			const t = props.t;
			const [query, setQuery] = react.useState("");
			const [state, setState] = react.useState({ phase: "idle" });
			const submit = async (event) => {
				if (event !== undefined) event.preventDefault();
				const value = query.trim();
				if (value === "") return;
				setState({ phase: "loading" });
				try {
					setState({ phase: "ready", result: await props.runSearch(value) });
				} catch (error) {
					setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
				}
			};
			const openHit = (item, activeQuery) => {
				if (typeof props.openView === "function") props.openView("chat", "");
				setTimeout(() => {
					void props.jumpToSession(item, activeQuery);
				}, 80);
			};
			const result = state.phase === "ready" ? state.result : undefined;
			return jsxRuntime.jsxs("div", {
				className: "shs_view",
				children: [
					jsxRuntime.jsxs("form", {
						className: "shs_viewHead",
						onSubmit: submit,
						children: [
							jsxRuntime.jsx("input", {
								className: "shs_viewInput",
								value: query,
								placeholder: t("search.placeholder"),
								"aria-label": t("view.label"),
								onChange: (event) => setQuery(event.target.value)
							}),
							jsxRuntime.jsx("button", {
								type: "submit",
								className: "shs_viewSubmit",
								disabled: state.phase === "loading",
								children: t("view.submit")
							})
						]
					}),
					state.phase === "loading" ? jsxRuntime.jsx("p", { className: "shs_status", children: t("search.loading") }) : null,
					state.phase === "error" ? jsxRuntime.jsx("p", { className: "shs_status", style: { color: "var(--dsw-alias-state-error-primary)" }, children: t("search.error", { message: state.message }) }) : null,
					result !== undefined ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
						jsxRuntime.jsx("p", {
							className: "shs_status",
							children: t("search.count", {
								n: result.items.length,
								sessions: result.scannedSessions,
								messages: result.scannedMessages,
								ms: result.tookMs
							})
						}),
						result.items.length === 0 ? jsxRuntime.jsx("div", { className: "shs_empty", children: t("search.empty") }) : jsxRuntime.jsx("ul", {
							className: "shs_list",
							children: result.items.map((item) => jsxRuntime.jsx("li", {
								children: jsxRuntime.jsxs("button", {
									type: "button",
									className: "shs_item",
									title: item.cwd,
									onClick: () => openHit(item, result.query),
									children: [
										jsxRuntime.jsxs("span", {
											className: "shs_itemHead",
											children: [
												jsxRuntime.jsx("span", { className: "shs_itemTitle", children: item.title }),
												jsxRuntime.jsx("span", { className: item.role === "user" ? "shs_badge shs_badge_user" : "shs_badge", children: item.role === "user" ? t("role.user") : t("role.assistant") }),
												jsxRuntime.jsx("span", { className: "shs_time", children: formatTime(item.time) })
											]
										}),
										jsxRuntime.jsx("span", {
											className: "shs_snippet",
											children: highlightParts(item.snippet, result.query).map((part, partIndex) => (part.mark ? jsxRuntime.jsx("mark", { className: "shs_mark", children: part.text }, partIndex) : jsxRuntime.jsx("span", { children: part.text }, partIndex)))
										})
									]
								})
							}, `${item.sessionId}:${item.seq}`))
						}),
						result.hasMore === true ? jsxRuntime.jsx("p", { className: "shs_status", children: t("search.more", { n: result.items.length }) }) : null
					] }) : null
				]
			});
		}
		function SearchDialog({ useSearchOpen, closeSearch, runSearch, jumpToHit, probe, t }) {
			const open = useSearchOpen((value) => value);
			if (open !== true) return null;
			return jsxRuntime.jsx(SearchWindow, {
				onClose: closeSearch,
				runSearch,
				jumpToHit,
				probe,
				t
			});
		}
		function SearchWindow({ onClose, runSearch, jumpToHit, probe, t }) {
			const [query, setQuery] = react.useState("");
			const [state, setState] = react.useState({ phase: "idle" });
			const inputRef = react.useRef(null);
			react.useEffect(() => {
				probe({ phase: "window-render" });
				if (inputRef.current !== null) inputRef.current.focus();
			}, [probe]);
			react.useEffect(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, [onClose]);
			const submit = async (event) => {
				if (event !== undefined) event.preventDefault();
				const value = query.trim();
				if (value === "") return;
				setState({ phase: "loading" });
				try {
					setState({ phase: "ready", result: await runSearch(value) });
				} catch (error) {
					setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
				}
			};
			const result = state.phase === "ready" ? state.result : undefined;
			return jsxRuntime.jsx("div", {
				className: "shs_backdrop",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) onClose();
				},
				children: jsxRuntime.jsxs("div", {
					className: "shs_panel",
					role: "dialog",
					"aria-modal": "true",
					children: [
						jsxRuntime.jsxs("form", {
							className: "shs_head",
							onSubmit: submit,
							children: [
								jsxRuntime.jsx("input", {
									ref: inputRef,
									className: "shs_input",
									value: query,
									placeholder: t("search.placeholder"),
									"aria-label": t("page.title"),
									onChange: (event) => setQuery(event.target.value)
								}),
								jsxRuntime.jsx("button", {
									type: "submit",
									className: "shs_viewSubmit",
									disabled: state.phase === "loading",
									children: t("view.submit")
								})
							]
						}),
						jsxRuntime.jsxs("div", {
							className: "shs_body",
							children: [
								state.phase === "loading" ? jsxRuntime.jsx("p", { className: "shs_status", children: t("search.loading") }) : null,
								state.phase === "error" ? jsxRuntime.jsx("p", { className: "shs_status", style: { color: "var(--dsw-alias-state-error-primary)" }, children: t("search.error", { message: state.message }) }) : null,
								result !== undefined ? jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
									jsxRuntime.jsx("p", {
										className: "shs_status",
										children: t("search.count", {
											n: result.items.length,
											sessions: result.scannedSessions,
											messages: result.scannedMessages,
											ms: result.tookMs
										})
									}),
									result.items.length === 0 ? jsxRuntime.jsx("div", { className: "shs_empty", children: t("search.empty") }) : jsxRuntime.jsx("ul", {
										className: "shs_list",
										children: result.items.map((item) => jsxRuntime.jsxs("li", {
											children: jsxRuntime.jsxs("button", {
												type: "button",
												className: "shs_item",
												title: item.cwd,
												onClick: () => {
									void jumpToHit(item, result.query);
								},
												children: [
													jsxRuntime.jsxs("span", {
														className: "shs_itemHead",
														children: [
															jsxRuntime.jsx("span", { className: "shs_itemTitle", children: item.title }),
															jsxRuntime.jsx("span", { className: item.role === "user" ? "shs_badge shs_badge_user" : "shs_badge", children: item.role === "user" ? t("role.user") : t("role.assistant") }),
															jsxRuntime.jsx("span", { className: "shs_time", children: formatTime(item.time) })
														]
													}),
													jsxRuntime.jsx("span", {
														className: "shs_snippet",
														children: highlightParts(item.snippet, result.query).map((part, partIndex) => (part.mark ? jsxRuntime.jsx("mark", { className: "shs_mark", children: part.text }, partIndex) : jsxRuntime.jsx("span", { children: part.text }, partIndex)))
													})
												]
											})
										}, `${item.sessionId}:${item.seq}`))
									}),
									result.hasMore === true ? jsxRuntime.jsx("p", { className: "shs_status", children: t("search.more", { n: result.items.length }) }) : null
								] }) : null
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			const searchOpen = clientStore.createSnapshotStore(false);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-history-search: dictionaries");
			const probe = (payload) => {
				postJson(PROBE_ROUTE, payload).catch(() => {});
			};
			const runSearch = (query) => postJson(SEARCH_ROUTE, { query });
			const openSession = (sessionId) => {
				const uiWorkspace = ctx.get("uiWorkspace");
				if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === "function") uiWorkspace.openSession(sessionId);
			};
			const openSearch = () => searchOpen.set(true);
			const closeSearch = () => searchOpen.set(false);
		const jumpToSession = async (item, query) => {
			openSession(item.sessionId);
			await jumpToHit(item, query, openSession, () => {});
		};
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "session-history-search",
				locale: NS,
				inject: () => ({
					hooks: { searchOpen },
					closeSearch,
					runSearch,
					jumpToHit: (item, query) => jumpToHit(item, query, openSession, closeSearch),
					probe
				})
			}, SearchDialog));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "session-history-search",
				order: 40,
				label: () => t("view.label"),
				locale: NS,
				inject: () => ({ runSearch, jumpToSession, probe, t })
			}, SearchView));
			ctx.effect(() => {
				const onKeyDown = (event) => {
					if (event.ctrlKey === false || event.shiftKey === false || event.altKey === true) return;
					const code = event.code ?? "";
					const key = String(event.key ?? "").toLowerCase();
					if (code !== "KeyK" && key !== "k") return;
					event.preventDefault();
					openSearch();
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, "session-history-search: shortcut");
			ctx.effect(() => {
				const timer = setTimeout(() => {
					probe({ phase: "render", module: "session-history-search", version: 122, slot: "header-actions" });
				}, 1200);
				return () => clearTimeout(timer);
			}, "session-history-search: activation probe");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
