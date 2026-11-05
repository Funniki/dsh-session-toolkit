window.__ModuleLoader__.load({
	id: "dsh-session-move",
	factory: (require) => {
		var module = { exports: {} };
		// session-move:probe-installed
		try { fetch("/api/session.move.probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "module-eval", module: "session-move" }) }).catch(() => {}); } catch {}
		try { window.addEventListener("error", (event) => { try { fetch("/api/session.move.probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "window-error", module: "session-move", message: String((event && event.message) || (event && event.error && event.error.message) || "unknown") }) }).catch(() => {}); } catch {} }); } catch {}
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let clientStore = require("@deepseek-ai/dsh-client-store");
		//#region lib/types/client/styles.js
		/** The picker rows follow the dialog surface's own tokens and metrics. */
		const OPTION_CLASS = "swm_option";
		const TITLE_CLASS = "swm_option_title";
		const PATH_CLASS = "swm_option_path";
		const LIST_CLASS = "swm_list";
		const EMPTY_CLASS = "swm_empty";
		const CSS = [
			`.${LIST_CLASS}{display:flex;flex-direction:column;gap:6px;max-height:264px;overflow:auto;padding:2px}`,
			`.${OPTION_CLASS}{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;font:inherit;color:var(--dsw-alias-label-primary);background:0 0;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:8px 10px;cursor:pointer}`,
			`.${OPTION_CLASS}:hover{background:var(--dsw-alias-bg-layer-2)}`,
			`.${OPTION_CLASS}[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}`,
			`.${TITLE_CLASS}{font-size:13px;line-height:18px;font-weight:500}`,
			`.${PATH_CLASS}{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
			`.${EMPTY_CLASS}{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}`
		].join("");
		const CSS_TAG_ID = "dsh-session-move/Styles.module.css";
		if (typeof document !== "undefined") {
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`);
			if (existing === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-session-move";
				tag.dataset.pluginCss = CSS_TAG_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} else if (existing.textContent !== CSS) existing.textContent = CSS;
		}
		//#endregion
		//#region lib/types/client/route.js
		/** Browser-relative Host routes; the page resolves them against its own base. */
		const MOVE_ROUTE = "/api/session.move".slice(1);
		const TARGETS_ROUTE = "/api/session.move.targets".slice(1);
		const PROBE_ROUTE = "/api/session.move.probe".slice(1);
		/**
		 * POST one JSON body and return the parsed response.
		 * @param route - document-relative route.
		 * @param body - JSON body.
		 * @returns the parsed response body.
		 */
		async function postJson(route, body) {
			const response = await fetch(route, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
			const parsed = await response.json().catch(() => null);
			return { ok: response.ok, status: response.status, body: parsed };
		}
		/**
		 * List the Workspaces one Session can move to.
		 * @param sessionId - Session being moved.
		 * @returns the Host target listing.
		 */
		async function requestTargets(sessionId) {
			const { ok, body } = await postJson(TARGETS_ROUTE, { sessionId });
			if (!ok || body === null) throw new Error(typeof body?.message === "string" ? body.message : "无法读取工作区列表");
			return body;
		}
		/**
		 * Ask the Host to move one Session.
		 * @param sessionId - Session to move.
		 * @param targetWorkspaceId - destination Workspace id.
		 * @returns the Host result, including a queued busy outcome.
		 */
		async function requestMove(sessionId, targetWorkspaceId) {
			const { ok, body } = await postJson(MOVE_ROUTE, { sessionId, targetWorkspaceId });
			if (ok || body?.queued === true) return body ?? {};
			throw new Error(typeof body?.message === "string" && body.message.length > 0 ? body.message : "移动请求失败");
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Locale namespace owned by this plugin. */
		const NS = "session-move";
		const zh = {
			"menu.moveToWorkspace": "移动到工作区…",
			"dialog.title": "移动到工作区",
			"dialog.description": "把「{title}」移动到另一个工作区。会话 ID 与完整历史都会保留。",
			"dialog.loading": "正在读取工作区…",
			"dialog.empty": "没有可移动到的其他工作区。请先在侧边栏创建工作区。",
			"dialog.cancel": "取消",
			"dialog.confirm": "移动",
			"dialog.moving": "正在移动…",
			"dialog.failed": "移动失败：{message}",
			"toast.moved": "已移动到「{workspace}」",
			"toast.queued": "会话仍驻留内存，已排队；DSH 重启后会自动移动"
		};
		const en = {
			"menu.moveToWorkspace": "Move to workspace…",
			"dialog.title": "Move to workspace",
			"dialog.description": "Move “{title}” to another workspace. The session id and full history are preserved.",
			"dialog.loading": "Reading workspaces…",
			"dialog.empty": "No other workspace to move to. Create one in the sidebar first.",
			"dialog.cancel": "Cancel",
			"dialog.confirm": "Move",
			"dialog.moving": "Moving…",
			"dialog.failed": "Move failed: {message}",
			"toast.moved": "Moved to “{workspace}”",
			"toast.queued": "Session is still resident; queued and will move after DSH restarts"
		};
		//#endregion
		//#region lib/types/client/MoveSession.js
		/** Inline folder-with-arrow glyph used by the menu row. */
		function FolderArrowIcon() {
			return jsxRuntime.jsx("svg", {
				viewBox: "0 0 16 16",
				width: 14,
				height: 14,
				"aria-hidden": true,
				focusable: "false",
				children: [
					jsxRuntime.jsx("path", { d: "M1.75 4.1c0-.75.6-1.35 1.35-1.35h2.62c.4 0 .78.17 1.04.47l.78.86h5.34c.75 0 1.35.6 1.35 1.35v5.87c0 .75-.6 1.35-1.35 1.35H3.1c-.75 0-1.35-.6-1.35-1.35V4.1Z", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }),
					jsxRuntime.jsx("path", { d: "M6.4 8.6h3.6m-1.5-1.5 1.5 1.5-1.5 1.5", fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" })
				]
			});
		}
		/**
		 * The `sidebar.workspaces.session.menu.item` row: opens the workspace picker
		 * for the Session whose menu is open.
		 * @param props - the Session row share plus this plugin's own share.
		 * @returns the menu row.
		 */
		function MoveSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, openMoveRequest, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			return jsxRuntime.jsx(primitives.MenuItemButton, {
				icon: jsxRuntime.jsx(FolderArrowIcon, {}),
				onSelect: () => {
					setMenuOpen(false);
					openMoveRequest(sessionId, typeof displayTitle === "string" ? displayTitle : "");
				},
				children: t("menu.moveToWorkspace")
			});
		}
		/**
		 * The `shell.overlay` picker: one dialog per pending request.
		 * @param props - request hook, this plugin's share, and the locale seat.
		 * @returns the open dialog, or null.
		 */
		function MoveSessionDialog({ useMoveRequest, settleMoveRequest, requestTargetsFor, requestMoveFor, showToast, t }) {
			const request = useMoveRequest((pending) => pending);
			if (request === null) return null;
			return jsxRuntime.jsx(MoveSessionForm, {
				request,
				onClose: settleMoveRequest,
				requestTargetsFor,
				requestMoveFor,
				showToast,
				t
			}, request.sessionId);
		}
		/** One request's dialog: workspace list, selection, progress, and errors. */
		function MoveSessionForm({ request, onClose, requestTargetsFor, requestMoveFor, showToast, t }) {
			const [loading, setLoading] = react.useState(true);
			const [targets, setTargets] = react.useState([]);
			const [selected, setSelected] = react.useState(null);
			const [loadError, setLoadError] = react.useState(null);
			const [moving, setMoving] = react.useState(false);
			const [moveError, setMoveError] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				requestTargetsFor(request.sessionId).then((body) => {
					if (!alive) return;
					const usable = (Array.isArray(body?.targets) ? body.targets : []).filter((target) => target?.status === "ok");
					setTargets(usable);
					setSelected(usable.length > 0 ? usable[0].workspaceId : null);
					setLoading(false);
				}, (error) => {
					if (!alive) return;
					setLoadError(error instanceof Error ? error.message : String(error));
					setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [requestTargetsFor, request.sessionId]);
			const close = () => {
				if (moving) return;
				onClose();
			};
			const confirm = () => {
				if (selected === null || moving) return;
				const target = targets.find((candidate) => candidate.workspaceId === selected);
				setMoving(true);
				setMoveError(null);
				requestMoveFor(request.sessionId, selected).then((result) => {
					if (result?.queued === true) {
						showToast({ kind: "queued" });
					} else {
						showToast({ kind: "moved", workspaceTitle: target?.title ?? result?.target?.title ?? "" });
					}
					onClose();
				}, (error) => {
					setMoving(false);
					setMoveError(error instanceof Error ? error.message : String(error));
				});
			};
			const description = t("dialog.description", { title: request.displayTitle === "" ? request.sessionId : request.displayTitle });
			let content;
			if (loading) content = jsxRuntime.jsx("p", { className: EMPTY_CLASS, children: t("dialog.loading") });
			else if (loadError !== null) content = jsxRuntime.jsx("p", { className: EMPTY_CLASS, role: "alert", children: t("dialog.failed", { message: loadError }) });
			else if (targets.length === 0) content = jsxRuntime.jsx("p", { className: EMPTY_CLASS, children: t("dialog.empty") });
			else content = jsxRuntime.jsx("div", {
				className: LIST_CLASS,
				role: "radiogroup",
				children: targets.map((target) => jsxRuntime.jsxs("button", {
					type: "button",
					role: "radio",
					"aria-checked": selected === target.workspaceId,
					"aria-pressed": selected === target.workspaceId,
					className: OPTION_CLASS,
					onClick: () => {
						if (!moving) setSelected(target.workspaceId);
					},
					children: [
						jsxRuntime.jsx("span", { className: TITLE_CLASS, children: target.title === "" ? target.path : target.title }),
						jsxRuntime.jsx("span", { className: PATH_CLASS, title: target.path, children: target.path })
					]
				}, target.workspaceId))
			});
			return jsxRuntime.jsxs(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("dialog.cancel"),
				title: t("dialog.title"),
				description,
				footer: jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
					jsxRuntime.jsx(primitives.Button, {
						variant: "outline",
						disabled: moving,
						onClick: close,
						children: t("dialog.cancel")
					}),
					jsxRuntime.jsx(primitives.Button, {
						variant: "primary",
						disabled: moving || selected === null,
						onClick: confirm,
						children: moving ? t("dialog.moving") : t("dialog.confirm")
					})
				] }),
				children: [
					content,
					moveError === null ? null : jsxRuntime.jsx("p", {
						role: "alert",
						style: { color: "var(--dsw-alias-state-error-primary)", margin: "8px 0 0" },
						children: t("dialog.failed", { message: moveError })
					})
				]
			});
		}
		/**
		 * The `shell.overlay` result toast.
		 * @param props - the toast hook, its settlement, and the locale seat.
		 * @returns the toast, or null.
		 */
		function MoveSessionToast({ useMoveToast, dismissMoveToast, t }) {
			const notice = useMoveToast((pending) => pending);
			if (notice === null) return null;
			const text = notice.kind === "queued"
				? t("toast.queued")
				: t("toast.moved", { workspace: notice.workspaceTitle === "" ? "…" : notice.workspaceTitle });
			return jsxRuntime.jsx(primitives.Toast, { text, onDone: dismissMoveToast }, notice.id);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser plugin owning the "move Session to another Workspace" action. */
		const inject = ["slots", "locale"];
		/**
		 * Mount the menu row, the workspace picker, the toast, and the client probe.
		 * @param ctx - browser context carrying slots and locale.
		 */
		function apply(ctx) {
			try { fetch("/api/session.move.probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "client-apply", module: "session-move", duplicate: globalThis.__dshSessionMoveClientLoaded === true }) }).catch(() => {}); } catch {}
			// Guard against a duplicate module instance: the pack vendors this client
			// under its own node_modules AND the profile links the same package, so a
			// page can end up with two module instances. Registering the same slot id
			// twice at one priority is a hard error, so only the first instance mounts.
			if (globalThis.__dshSessionMoveClientLoaded === true) {
				console.warn("[session-move] duplicate client instance skipped");
				return;
			}
			globalThis.__dshSessionMoveClientLoaded = true;
			// session-move:guard-release
			try {
			const moveRequest = clientStore.createSnapshotStore(null);
			const moveToast = clientStore.createSnapshotStore(null);
			let noticeSeq = 0;
			let probed = false;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "session-move: browser dictionaries");
			const openMoveRequest = (sessionId, displayTitle) => {
				moveRequest.set({ sessionId, displayTitle });
			};
			const showToast = (notice) => {
				noticeSeq += 1;
				moveToast.set({ id: noticeSeq, kind: notice.kind === "queued" ? "queued" : "moved", workspaceTitle: notice.workspaceTitle ?? "" });
			};
			const probe = (payload) => {
				postJson(PROBE_ROUTE, payload).catch(() => {});
			};
			ctx.effect(() => {
				if (probed) return () => {};
				probed = true;
				const timer = setTimeout(() => {
					probe({ phase: "render", module: "session-move", version: 1 });
				}, 1500);
				return () => {
					clearTimeout(timer);
				};
			}, "session-move: activation probe");
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "session-move-to-workspace",
				order: 410,
				locale: NS,
				inject: () => ({ openMoveRequest })
			}, MoveSessionMenuItem));
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "session-move",
					locale: NS,
					inject: () => ({
						hooks: { moveRequest },
						settleMoveRequest: () => {
							moveRequest.set(null);
						},
						requestTargetsFor: (sessionId) => requestTargets(sessionId),
						requestMoveFor: (sessionId, targetWorkspaceId) => requestMove(sessionId, targetWorkspaceId),
						showToast
					})
				}, MoveSessionDialog);
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "session-move-toast",
					locale: NS,
					inject: () => ({
						hooks: { moveToast },
						dismissMoveToast: () => {
							moveToast.set(null);
						}
					})
				}, MoveSessionToast);
			});
			try { fetch("/api/session.move.probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "client-mounted", module: "session-move" }) }).catch(() => {}); } catch {}
			} catch (error) {
				globalThis.__dshSessionMoveClientLoaded = false;
				try { fetch("/api/session.move.probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "client-error", module: "session-move", message: String((error && error.message) || error) }) }).catch(() => {}); } catch {}
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
