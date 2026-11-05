window.__ModuleLoader__.load({
	id: "dsh-archived-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let clientStore = require("@deepseek-ai/dsh-client-store");
		//#region lib/types/client/styles.js
		/**
		 * The two host-CSS surfaces this plugin mirrors. The row's hover strip and
		 * the "..." menu are rendered by ui-workspace, whose stylesheet module is
		 * private to that package, so the hover button copies the shipped
		 * `iconButton` metrics exactly (16×16 icon box, `--dsw-radius-xs`, tertiary
		 * label color, no background in any state, color-only hover) and deviates
		 * only in the hovered hue — the destructive action turns the error color
		 * instead of the primary label color. The menu separator copies the shipped
		 * `separator` metrics (the same `.5px` hairline the primitives draw).
		 */
		const HOVER_BUTTON_CLASS = "adsd_hover_button";
		const MENU_SEPARATOR_CLASS = "adsd_menu_separator";
		const CSS = [
			`.${HOVER_BUTTON_CLASS}{border-radius:var(--dsw-radius-xs);cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}`,
			`.${HOVER_BUTTON_CLASS}:hover{color:var(--dsw-alias-state-error-primary)}`,
			`.${MENU_SEPARATOR_CLASS}{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2)}`
		].join("");
		const CSS_TAG_ID = "dsh-archived-session-delete/Styles.module.css";
		if (typeof document !== "undefined") {
			/* A plugin reload normally tears the old style tag down before this
			 * factory runs again; rewriting the tag's text when it survived keeps a
			 * live reload from pinning an older stylesheet revision in place. */
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`);
			if (existing === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-archived-session-delete";
				tag.dataset.pluginCss = CSS_TAG_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} else if (existing.textContent !== CSS) existing.textContent = CSS;
		}
		//#endregion
		//#region lib/types/client/route.js
		/**
		 * Browser-relative form of the Host registration `/api/session.delete`:
		 * the page resolves it against its own document base, exactly as the
		 * shipped Session-log download route does.
		 */
		const SESSION_DELETE_ROUTE = "/api/session.delete".slice(1);
		//#endregion
		//#region lib/types/client/derived.js
		/**
		 * Project one observable into another, recomputing only when the source
		 * snapshot changes identity so a per-row Set lookup never rebuilds it.
		 * @param source - the observable to project.
		 * @param project - pure projection of one source snapshot.
		 * @returns the projected observable, subscribing through the source.
		 */
		function derive(source, project) {
			let seen;
			let value;
			return {
				getSnapshot: () => {
					const snapshot = source.getSnapshot();
					if (value === undefined || snapshot !== seen) {
						seen = snapshot;
						value = project(snapshot);
					}
					return value;
				},
				subscribe: (listener) => source.subscribe(listener)
			};
		}
		//#endregion
		//#region lib/types/client/delete.js
		/**
		 * Ask the Host to delete one archived Session and report the response body.
		 * @param sessionId - the archived Session to delete.
		 * @returns the Host response body.
		 * @throws the Host's own message when the request is refused.
		 */
		async function requestSessionDelete(sessionId) {
			const response = await fetch(SESSION_DELETE_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId })
			});
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(typeof body?.message === "string" && body.message.length > 0 ? body.message : `the delete request failed: HTTP ${String(response.status)}`);
			return body;
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Locale namespace owned by this plugin. */
		const NS = "archived-session-delete";
		/** Simplified-Chinese strings. */
		const zh = {
			"menu.deleteSession": "删除会话",
			"dialog.title": "删除已归档会话",
			"dialog.description": "将永久删除“{title}”，并从磁盘移除它的会话日志。此操作无法撤销。",
			"dialog.cancel": "取消",
			"dialog.confirm": "删除",
			"dialog.deleting": "正在删除…",
			"dialog.failed": "删除失败：{message}",
			"toast.deleted": "会话已删除"
		};
		/** English strings. */
		const en = {
			"menu.deleteSession": "Delete session",
			"dialog.title": "Delete archived session",
			"dialog.description": "Permanently delete “{title}” and remove its stored session log from disk. This cannot be undone.",
			"dialog.cancel": "Cancel",
			"dialog.confirm": "Delete",
			"dialog.deleting": "Deleting…",
			"dialog.failed": "Delete failed: {message}",
			"toast.deleted": "Session deleted"
		};
		//#endregion
		//#region lib/types/client/DeleteSession.js
		/**
		 * The `sidebar.workspaces.session.menu.item` row (order 440, between the
		 * shipped archive row at 400 and the shipped "Copy Session ID" row at 450):
		 * the destructive action for one archived Session. It renders nothing for a
		 * Session that is not archived, because this feature owns deletion of
		 * archived Sessions only, and it draws its own separator *after* the row so
		 * the menu reads "取消归档 / 删除会话 ── 复制 Session ID": the destructive
		 * action stays grouped with the row actions above it, and the copy action
		 * begins a new group.
		 * @param props - the Session row share plus this plugin's own share.
		 * @returns the menu row and its trailing hairline, or null.
		 */
		function DeleteArchivedSessionMenuItem({ sessionId, displayTitle, useArchived, useMenuOpenState, openDeleteRequest, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			const archived = useArchived((set) => set.has(sessionId));
			if (!archived) return null;
			return jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [jsxRuntime.jsx(primitives.MenuItemButton, {
				danger: true,
				icon: jsxRuntime.jsx(primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: () => {
					setMenuOpen(false);
					openDeleteRequest(sessionId, displayTitle);
				},
				children: t("menu.deleteSession")
			}), jsxRuntime.jsx("div", {
				className: MENU_SEPARATOR_CLASS,
				role: "separator"
			})] });
		}
		/**
		 * The `sidebar.workspaces.session.row.action` hover button (order 150, to the
		 * right of the shipped archive/unarchive button at 100): the same delete
		 * action the menu offers, one hover away. It renders only for an archived
		 * Session, and it is styled as one of the row's own icon buttons: 16×16,
		 * tertiary label color and no background in any state, so it measures and
		 * spaces exactly like the "..." trigger and the archive button beside it.
		 * The single deviation is the hovered hue: this destructive action turns
		 * the error color while the shipped buttons turn the primary label color.
		 * @param props - the Session row share plus this plugin's own share.
		 * @returns the hover button, or null.
		 */
		function DeleteArchivedSessionRowButton({ sessionId, displayTitle, useArchived, openDeleteRequest, t }) {
			const archived = useArchived((set) => set.has(sessionId));
			if (!archived) return null;
			const label = t("menu.deleteSession");
			return jsxRuntime.jsx(primitives.Tooltip, {
				label,
				side: "bottom",
				align: "end",
				delayMs: 500,
				portal: true,
				children: jsxRuntime.jsx("button", {
					type: "button",
					className: HOVER_BUTTON_CLASS,
					"aria-label": label,
					onClick: () => {
						openDeleteRequest(sessionId, displayTitle);
					},
					children: jsxRuntime.jsx(primitives.IconTrashOutlineRegular, {})
				})
			});
		}
		/**
		 * The `shell.overlay` confirmation: one dialog per pending request, keyed
		 * by Session so in-flight state dies with its request.
		 * @param props - the request hook, this plugin's share, and the locale seat.
		 * @returns the open dialog, or null.
		 */
		function DeleteArchivedSessionDialog({ useDeleteRequest, settleDeleteRequest, deleteArchivedSession, t }) {
			const request = useDeleteRequest((pending) => pending);
			if (request === null) return null;
			return jsxRuntime.jsx(DeleteSessionForm, {
				request,
				onConfirm: deleteArchivedSession,
				onSettle: settleDeleteRequest,
				t
			}, request.sessionId);
		}
		/** One request's dialog: confirmation, progress, and the Host's refusal text. */
		function DeleteSessionForm({ request, onConfirm, onSettle, t }) {
			const [deleting, setDeleting] = react.useState(false);
			const [error, setError] = react.useState(null);
			const close = () => {
				if (deleting) return;
				onSettle();
			};
			const confirm = () => {
				setDeleting(true);
				setError(null);
				onConfirm(request.sessionId).then(() => {
					onSettle();
				}, (reason) => {
					setDeleting(false);
					setError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			return jsxRuntime.jsxs(primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("dialog.cancel"),
				title: t("dialog.title"),
				description: t("dialog.description", { title: request.displayTitle === "" ? request.sessionId : request.displayTitle }),
				footer: jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
					jsxRuntime.jsx(primitives.Button, {
						variant: "outline",
						disabled: deleting,
						onClick: close,
						children: t("dialog.cancel")
					}),
					jsxRuntime.jsx(primitives.Button, {
						variant: "primary",
						disabled: deleting,
						onClick: confirm,
						children: deleting ? t("dialog.deleting") : t("dialog.confirm")
					})
				] }),
				children: error === null ? undefined : jsxRuntime.jsx("p", {
					role: "alert",
					style: { color: "var(--dsw-alias-state-error-primary)", margin: 0 },
					children: t("dialog.failed", { message: error })
				})
			});
		}
		/**
		 * The `shell.overlay` result notice: one toast after a successful delete.
		 * @param props - the notice hook and its settlement.
		 * @returns the toast, or null.
		 */
		function DeleteSessionToast({ useDeleteToast, dismissDeleteToast, t }) {
			const notice = useDeleteToast((pending) => pending);
			if (notice === null) return null;
			return jsxRuntime.jsx(primitives.Toast, {
				text: t("toast.deleted"),
				onDone: dismissDeleteToast
			}, notice.id);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser plugin owning the archived-Session delete action and its confirmation. */
		const inject = ["slots", "locale", "workspaces"];
		/**
		 * Mount the delete menu row, its confirmation, and its result toast.
		 * @param ctx - browser context carrying slots, locale, and the Workspace list.
		 */
		function apply(ctx) {
			const workspaces = ctx.get("workspaces");
			const archivedSet = derive(workspaces.list, (snapshot) => new Set(snapshot.archivedSessionIds));
			const deleteRequest = clientStore.createSnapshotStore(null);
			const deleteToast = clientStore.createSnapshotStore(null);
			let noticeSeq = 0;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "archived-session-delete: browser dictionaries");
			const openDeleteRequest = (sessionId, displayTitle) => {
				deleteRequest.set({
					sessionId,
					displayTitle: typeof displayTitle === "string" ? displayTitle : ""
				});
			};
			const itemInjected = () => ({
				hooks: { archived: archivedSet },
				openDeleteRequest
			});
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "delete-archived-session",
				order: 440,
				locale: NS,
				inject: itemInjected
			}, DeleteArchivedSessionMenuItem));
			ctx.slots.inject("sidebar.workspaces.session.row.action", () => ctx.slots.register({
				name: "sidebar.workspaces.session.row.action",
				id: "delete-archived-session",
				order: 150,
				locale: NS,
				inject: itemInjected
			}, DeleteArchivedSessionRowButton));
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "archived-session-delete",
					locale: NS,
					inject: () => ({
						hooks: { deleteRequest },
						settleDeleteRequest: () => {
							deleteRequest.set(null);
						},
						deleteArchivedSession: async (sessionId) => {
							await requestSessionDelete(sessionId);
							noticeSeq += 1;
							deleteToast.set({ id: noticeSeq });
						}
					})
				}, DeleteArchivedSessionDialog);
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "archived-session-delete-toast",
					locale: NS,
					inject: () => ({
						hooks: { deleteToast },
						dismissDeleteToast: () => {
							deleteToast.set(null);
						}
					})
				}, DeleteSessionToast);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
