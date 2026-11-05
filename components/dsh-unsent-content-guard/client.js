window.__ModuleLoader__.load({
	id: "dsh-unsent-content-guard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		//#region lib/types/client/route.js
		/**
		 * Browser-relative Host routes: the page resolves them against its own
		 * document base, exactly as the shipped Session-log download route does.
		 */
		const API = "/api/unsent-content".slice(1);
		//#endregion
		//#region lib/types/client/styles.js
		/**
		 * The dock pill mirrors the shipped composer stats pills (`StatsPills.module.css`):
		 * same anchor metrics, radius, muted color, hover, icon size and truncation.
		 * Only the class names are the plugin's own.
		 */
		const CSS = [
			".uig_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}",
			".uig_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
			".uig_pill svg{flex:none;width:14px;height:14px}",
			".uig_pill{cursor:pointer}",
			".uig_pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".uig_label{text-overflow:ellipsis;min-width:0;overflow:hidden}"
		].join("");
		const CSS_TAG_ID = "dsh-unsent-content-guard/Styles.module.css";
		if (typeof document !== "undefined") {
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`);
			if (existing === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-unsent-content-guard";
				tag.dataset.pluginCss = CSS_TAG_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} else if (existing.textContent !== CSS) existing.textContent = CSS;
		}
		//#endregion
		//#region lib/types/client/locales.js
		const NS = "unsent-content-guard";
		const zh = {
			"pill.images": "未发送图片 {n} 张",
			"pill.texts": "未发送文字 {n} 条",
			"pill.both": "未发送备份：图片 {images} 张 · 文字 {texts} 条",
			"pill.title": "打开备份目录"
		};
		const en = {
			"pill.images": "{n} unsent image(s) saved",
			"pill.texts": "{n} unsent text(s) saved",
			"pill.both": "Unsent backup: {images} image(s) · {texts} text(s)",
			"pill.title": "Open the backup folder"
		};
		//#endregion
		//#region lib/types/client/support.js
		/** Empty list reused by the selector so an unchanged state keeps its identity. */
		const EMPTY_IDS = Object.freeze([]);
		/** How long after a submission the client must not race the Host's commit cleanup. */
		const SUBMIT_GRACE_MS = 60000;
		/** Delay before re-checking image drafts that left the composer but the browser still held. */
		const RELEASE_RECHECK_MS = 2500;
		/** Delay before re-checking draft ids released by a component that just unmounted. */
		const DROPPED_CHECK_MS = 1500;
		/** Delay before the first restore attempt in a freshly mounted composer. */
		const RESTORE_DELAY_MS = 900;
		/** Largest number of image drafts restored in one attempt. */
		const RESTORE_BATCH = 6;
		/** Give up automatic restore after this many blocked attempts for one draft. */
		const RESTORE_MAX_ATTEMPTS = 8;

		/**
		 * POST one JSON request to a Host route and report its body.
		 * @param path - document-relative route.
		 * @param body - JSON-serializable payload.
		 * @returns the parsed response body.
		 * @throws when the exchange or the Host refusal fails.
		 */
		async function postJson(path, body) {
			const response = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload === null || payload.ok === false) {
				throw new Error(typeof payload?.message === "string" ? payload.message : `HTTP ${String(response.status)}`);
			}
			return payload;
		}

		/**
		 * Encode bytes as canonical base64 in bounded chunks.
		 * @param bytes - raw bytes to encode.
		 * @returns base64 text.
		 */
		function encodeBase64(bytes) {
			let binary = "";
			const chunk = 32768;
			for (let offset = 0; offset < bytes.length; offset += chunk) {
				binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
			}
			return btoa(binary);
		}

		/**
		 * Decode canonical base64 into bytes.
		 * @param text - base64 text.
		 * @returns the decoded bytes.
		 */
		function decodeBase64(text) {
			const binary = atob(text);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return bytes;
		}

		/**
		 * Create one minimal external snapshot store.
		 * @param initial - initial value.
		 * @returns the store.
		 */
		function createSnapshotStore(initial) {
			let value = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => value,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(next) {
					if (Object.is(next, value)) return;
					value = next;
					for (const listener of [...listeners]) listener();
				}
			};
		}

		/**
		 * Read one external snapshot store as a React hook.
		 * @param store - the store.
		 * @returns its current value.
		 */
		function useSnapshot(store) {
			return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
		}

		/** Inline document icon: a framed picture with a small save arrow. */
		const ICON = h("svg", { viewBox: "0 0 16 16", "aria-hidden": true, focusable: "false" }, [
			h("path", { key: "frame", d: "M2.5 2.5h6M13.5 2.5v3M2.5 2.5v9a1 1 0 0 0 1 1h4M13.5 2.5h-1", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", fill: "none" }),
			h("rect", { key: "photo", x: 2.5, y: 2.5, width: 11, height: 9, rx: 1.6, stroke: "currentColor", strokeWidth: 1.2, fill: "none" }),
			h("circle", { key: "sun", cx: 5.6, cy: 5.6, r: 1, fill: "currentColor" }),
			h("path", { key: "hill", d: "M2.8 10.4l2.6-2.6 1.8 1.8 1.6-1.6 2.4 2.4", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" }),
			h("path", { key: "save", d: "M12.6 10.2v3.3m-1.6-1.6l1.6 1.6 1.6-1.6", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" })
		]);
		//#endregion
		//#region lib/types/client/guard.js
		/**
		 * The composer-dock pill: invisible while nothing is saved, otherwise one
		 * line summarizing the saved unsent input that opens the backup folder. The
		 * same component observes the composer's draft text and draft attachment ids
		 * and asks the Host to save them.
		 *
		 * Copies leave the Host only in two ways: a committed `user/message` (a
		 * successful send) and a client discard when the user removes the draft from
		 * the composer. A draft a Session switch *dropped* is never discarded: it is
		 * recreated from its backup when its own Session is opened again, so an
		 * unsent image survives switching.
		 * @param props - standard dock props (input state, session id, input actions),
		 * the locale seat, and this plugin's guard share.
		 * @returns the pill, or null.
		 */
		function UnsentContentPill({ useInput, inputActions, sessionId, t, guard }) {
			const attachmentIds = useInput((state) => (state !== undefined && Array.isArray(state.attachmentIds) ? state.attachmentIds : EMPTY_IDS));
			const draft = useInput((state) => (state !== undefined && typeof state.draft === "string" ? state.draft : ""));
			const phase = useInput((state) => (state !== undefined && typeof state.phase === "string" ? state.phase : "plain"));
			const summary = useSnapshot(guard.summary);
			const previous = React.useRef(undefined);
			const submitAt = React.useRef(0);
			const lastText = React.useRef({ text: "", hash: "" });
			React.useEffect(() => {
				if (phase !== "plain") submitAt.current = Date.now();
			}, [phase]);
			React.useEffect(() => {
				guard.observeAttachments(sessionId, attachmentIds);
				const prior = previous.current;
				if (prior === undefined || prior.sessionId !== sessionId) {
					if (prior !== undefined && prior.ids.length > 0) guard.scheduleReleasedCheck(prior.sessionId, prior.ids);
					previous.current = { sessionId, ids: attachmentIds };
				} else {
					const current = new Set(attachmentIds);
					const removed = prior.ids.filter((id) => !current.has(id));
					previous.current = { sessionId, ids: attachmentIds };
					if (removed.length > 0) guard.discardDroppedImages(removed, Date.now() - submitAt.current < SUBMIT_GRACE_MS);
				}
				if (attachmentIds.length === 0) guard.maybeRestore();
				guard.refresh();
			}, [guard, sessionId, attachmentIds]);
			React.useEffect(() => {
				const timer = setTimeout(() => {
					if (draft.trim() === "") {
						const prior = lastText.current;
						lastText.current = { text: "", hash: "" };
						if (prior.hash !== "" && Date.now() - submitAt.current >= SUBMIT_GRACE_MS) guard.discardTextHashes([prior.hash]);
						guard.refresh();
						return;
					}
					guard.saveText(sessionId, draft).then((hash) => {
						if (typeof hash === "string" && hash !== "") lastText.current = { text: draft, hash };
					});
					guard.refresh();
				}, 700);
				return () => {
					clearTimeout(timer);
				};
			}, [guard, sessionId, draft]);
			React.useEffect(() => {
				if (inputActions === undefined) return;
				guard.attachComposer({ sessionId, inputActions, attachmentIds });
			}, [guard, sessionId, inputActions, attachmentIds]);
			React.useEffect(() => {
				if (inputActions === undefined) return undefined;
				const timer = setTimeout(() => {
					guard.maybeRestore();
				}, RESTORE_DELAY_MS);
				return () => {
					clearTimeout(timer);
					guard.detachComposer(sessionId);
				};
			}, [guard, sessionId, inputActions]);
			React.useEffect(() => {
				return () => {
					const prior = previous.current;
					if (prior !== undefined) guard.scheduleReleasedCheck(prior.sessionId, prior.ids);
				};
			}, [guard]);
			React.useEffect(() => {
				guard.probeRender();
				guard.refresh();
				const timer = setInterval(() => {
					guard.refresh();
				}, 30000);
				return () => {
					clearInterval(timer);
				};
			}, [guard]);
			if (!summary || (summary.images <= 0 && summary.texts <= 0)) return null;
			const label = summary.images > 0 && summary.texts > 0
				? t("pill.both", { images: summary.images, texts: summary.texts })
				: summary.images > 0 ? t("pill.images", { n: summary.images }) : t("pill.texts", { n: summary.texts });
			const title = t("pill.title");
			return h("span", { className: "uig_anchor" }, h("button", {
				type: "button",
				className: "uig_pill",
				title,
				"aria-label": `${label}. ${title}`,
				onClick: () => {
					guard.reveal();
				}
			}, ICON, h("span", { className: "uig_label" }, label)));
		}

		/**
		 * Contain a slot-entry failure: a broken contribution renders nothing
		 * instead of blanking the composer dock.
		 */
		class GuardBoundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}

			/** @returns fallback state after a child failure. */
			static getDerivedStateFromError() {
				return { failed: true };
			}

			/** @param error - the contained failure. */
			componentDidCatch(error) {
				console.warn("[unsent-content-guard] dock pill failed:", error);
			}

			/** @returns the guarded child, or null after a failure. */
			render() {
				return this.state.failed ? null : this.props.children;
			}
		}

		/** Slot entry: one error boundary around the real pill. */
		function UnsentContentEntry(props) {
			return h(GuardBoundary, null, h(UnsentContentPill, props));
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser plugin owning the unsent-input backup pill, the draft capture, and the restore path. */
		const inject = ["slots", "locale"];
		/**
		 * Mount the dock pill, the draft observer, the restore path, and the Host probes.
		 * @param ctx - browser context carrying slots and the dictionary registry.
		 */
		function apply(ctx) {
			const summary = createSnapshotStore({ images: 0, texts: 0 });
			const capturedImages = new Set();
			const lastTexts = new Map();
			const pageLoadAt = Date.now();
			/** Draft ids a Session switch released, kept for restore into their own Session. */
			const releasedDrafts = new Map();
			/** Draft ids already restored on this page. */
			const restoredDrafts = new Set();
			/** The mounted composer this guard may restore into. */
			let composer = undefined;
			let refreshing = false;
			let restoring = false;
			let renderProbed = false;

			/**
			 * Report one diagnostic line to the Host probe log.
			 * @param payload - JSON-serializable diagnostic.
			 */
			const probe = (payload) => {
				postJson(`${API}/probe`, payload).catch(() => {});
			};

			/**
			 * Resolve browser draft descriptors by id.
			 * @param ids - draft attachment ids.
			 * @returns the drafts that are still registered.
			 */
			const resolveDrafts = (ids) => {
				const conversation = ctx.get("conversation");
				if (conversation === undefined || typeof conversation.resolveDraftAttachments !== "function") return [];
				return conversation.resolveDraftAttachments(ids);
			};

			/** Refresh the saved-copy counts from the Host. */
			const refresh = () => {
				if (refreshing) return Promise.resolve();
				refreshing = true;
				return postJson(`${API}/list`, {}).then((payload) => {
					summary.set({
						images: typeof payload.images === "number" ? payload.images : 0,
						texts: typeof payload.texts === "number" ? payload.texts : 0
					});
				}).catch(() => {}).finally(() => {
					refreshing = false;
				});
			};

			/**
			 * Ask the Host to back up one new image draft.
			 * @param sessionId - current session identity.
			 * @param draftId - browser draft attachment id.
			 */
			const captureImage = async (sessionId, draftId) => {
				const draft = resolveDrafts([draftId])[0];
				if (draft === undefined || draft.kind !== "image" || draft.file === undefined) return;
				const bytes = new Uint8Array(await draft.file.arrayBuffer());
				const name = typeof draft.file.name === "string" && draft.file.name !== "" ? draft.file.name : `${draftId}.png`;
				const mediaType = typeof draft.file.type === "string" && draft.file.type !== "" ? draft.file.type : "image/png";
				await postJson(`${API}/save-image`, {
					sessionId,
					draftId,
					name,
					mediaType,
					data: encodeBase64(bytes)
				});
				probe({ phase: "capture-image", draftId, bytes: bytes.length });
				await refresh();
			};

			/**
			 * Capture every image draft id this page has not seen yet.
			 * @param sessionId - current session identity.
			 * @param ids - current draft attachment ids.
			 */
			const observeAttachments = (sessionId, ids) => {
				for (const id of ids) {
					if (capturedImages.has(id)) continue;
					capturedImages.add(id);
					captureImage(sessionId, id).catch((error) => {
						probe({ phase: "capture-image-error", draftId: id, message: error instanceof Error ? error.message : String(error) });
					});
				}
			};

			/**
			 * Keep the Host's copy of this session's unsent text current.
			 * @param sessionId - current session identity.
			 * @param draft - composer text.
			 * @returns the stored content digest, when the text was saved.
			 */
			const saveText = (sessionId, draft) => {
				if (typeof sessionId !== "string" || sessionId === "") return Promise.resolve(undefined);
				if (typeof draft !== "string" || draft.trim() === "") return Promise.resolve(undefined);
				const previous = lastTexts.get(sessionId);
				if (previous !== undefined && previous.text === draft) return Promise.resolve(previous.hash);
				return postJson(`${API}/save-text`, { sessionId, text: draft }).then((payload) => {
					const hash = typeof payload.hash === "string" ? payload.hash : "";
					lastTexts.set(sessionId, { text: draft, hash });
					probe({ phase: "capture-text", sessionId, chars: draft.length });
					refresh();
					return hash;
				}).catch((error) => {
					lastTexts.delete(sessionId);
					probe({ phase: "capture-text-error", sessionId, message: error instanceof Error ? error.message : String(error) });
					return undefined;
				});
			};

			/**
			 * Drop Host copies of image drafts the user removed from the composer.
			 * A draft the browser still resolves may be one a successful send has not
			 * released yet, so it gets one delayed re-check before it is kept.
			 * @param ids - draft ids that left the composer.
			 * @param suppressed - a submission may still commit them; never race it.
			 */
			const discardDroppedImages = (ids, suppressed) => {
				if (ids.length === 0) return;
				if (suppressed) {
					probe({ phase: "discard-skipped-submission", draftIds: ids });
					return;
				}
				const alive = new Set(resolveDrafts(ids).map((draft) => draft.id));
				const dropped = ids.filter((id) => !alive.has(id));
				const held = ids.filter((id) => alive.has(id));
				if (dropped.length > 0) {
					postJson(`${API}/discard`, { draftIds: dropped }).then(() => {
						probe({ phase: "discard-images", draftIds: dropped });
						refresh();
					}).catch(() => {});
				}
				if (held.length === 0) return;
				/* A draft released a moment later is a send that just committed; keep the
				 * backup until this re-check so a live draft of another Session survives. */
				setTimeout(() => {
					const stillAlive = new Set(resolveDrafts(held).map((draft) => draft.id));
					const released = held.filter((id) => !stillAlive.has(id));
					if (released.length === 0) {
						probe({ phase: "discard-kept-moved", draftIds: held });
						return;
					}
					postJson(`${API}/discard`, { draftIds: released }).then(() => {
						probe({ phase: "discard-released-after-send", draftIds: released });
						refresh();
					}).catch(() => {});
				}, RELEASE_RECHECK_MS);
			};

			/**
			 * Drop one text copy by its stored digest (the user cleared the draft).
			 * @param hashes - stored text digests.
			 */
			const discardTextHashes = (hashes) => {
				const targets = hashes.filter((hash) => typeof hash === "string" && hash !== "");
				if (targets.length === 0) return;
				postJson(`${API}/discard`, { hashes: targets }).then(() => {
					probe({ phase: "discard-text", hashes: targets });
					refresh();
				}).catch(() => {});
			};

			/**
			 * Note a draft a Session switch released. Its backup is kept and restored
			 * when its own Session is opened again.
			 * @param sessionId - Session the draft belonged to.
			 * @param ids - draft ids the unmounted composer held.
			 */
			const scheduleReleasedCheck = (sessionId, ids) => {
				if (ids.length === 0) return;
				setTimeout(() => {
					const alive = new Set(resolveDrafts(ids).map((draft) => draft.id));
					const released = ids.filter((id) => !alive.has(id));
					for (const id of released) {
						const known = releasedDrafts.get(id);
						releasedDrafts.set(id, {
							sessionId,
							attempts: known === undefined ? 0 : known.attempts
						});
					}
					if (released.length > 0) {
						probe({ phase: "carry-pending", sessionId, draftIds: released });
						refresh();
						maybeRestore();
					}
				}, DROPPED_CHECK_MS);
			};

			/**
			 * Track the composer the guard may restore into.
			 * @param state - mounted composer state.
			 */
			const attachComposer = (state) => {
				composer = state;
			};

			/**
			 * Forget the composer when it unmounts.
			 * @param sessionId - Session the unmounting composer showed.
			 */
			const detachComposer = (sessionId) => {
				if (composer !== undefined && composer.sessionId === sessionId) composer = undefined;
			};

			/**
			 * Recreate image drafts a Session switch or a restart dropped, once their own
			 * Session is open again. Restores into an empty attachment rail only; the old
			 * backup is dropped after the restored draft saved itself under its new id.
			 */
			const maybeRestore = () => {
				if (restoring || composer === undefined) return;
				const active = composer;
				if (active.attachmentIds.length > 0) return;
				const conversation = ctx.get("conversation");
				if (conversation === undefined || typeof conversation.createDrafts !== "function") return;
				restoring = true;
				postJson(`${API}/list`, {}).then(async (payload) => {
					const policy = payload.restore !== null && typeof payload.restore === "object" ? payload.restore : {};
					const onOpen = policy.onOpen !== false;
					const maxAgeHours = typeof policy.maxAgeHours === "number" && policy.maxAgeHours > 0 ? policy.maxAgeHours : 24;
					const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
					const now = Date.now();
					const candidates = [];
					for (const entry of Array.isArray(payload.entries) ? payload.entries : []) {
						if (entry.kind !== "image" || typeof entry.draftId !== "string") continue;
						if (entry.sessionId !== active.sessionId || restoredDrafts.has(entry.draftId)) continue;
						/* Restore a draft this page saw a Session switch release, or (with the
						 * default restoreOnOpen) an unsent copy from an earlier run, so a restart
						 * or reload brings the image back. The Host refuses and drops a copy its
						 * Session already committed, so sent content cannot be re-inserted. */
						const held = releasedDrafts.has(entry.draftId);
						const previousRun = onOpen && typeof entry.savedAt === "number" && entry.savedAt < pageLoadAt && now - entry.savedAt <= maxAgeMs;
						if (!held && !previousRun) continue;
						candidates.push(entry);
						if (candidates.length >= RESTORE_BATCH) break;
					}
					if (candidates.length === 0) return;
					const alive = new Set(resolveDrafts(candidates.map((entry) => entry.draftId)).map((draft) => draft.id));
					const pending = candidates.filter((entry) => !alive.has(entry.draftId));
					for (const entry of candidates) {
						if (!alive.has(entry.draftId)) continue;
						releasedDrafts.delete(entry.draftId);
					}
					if (pending.length === 0) return;
					const files = [];
					const restored = [];
					for (const entry of pending) {
						const known = releasedDrafts.get(entry.draftId);
						if (known !== undefined && known.attempts >= RESTORE_MAX_ATTEMPTS) {
							releasedDrafts.delete(entry.draftId);
							probe({ phase: "restore-gaveup", draftId: entry.draftId });
							continue;
						}
						try {
							const read = await postJson(`${API}/read-image`, { draftId: entry.draftId });
							const bytes = decodeBase64(typeof read.data === "string" ? read.data : "");
							const mediaType = typeof read.mediaType === "string" && read.mediaType !== "" ? read.mediaType : "image/png";
							const name = typeof read.name === "string" && read.name !== "" ? read.name : `${entry.draftId}.png`;
							files.push(new File([bytes], name, { type: mediaType }));
							restored.push(entry.draftId);
						} catch (error) {
							releasedDrafts.delete(entry.draftId);
							restoredDrafts.add(entry.draftId);
							const message = error instanceof Error ? error.message : String(error);
							/* The Host refuses and drops a copy whose content its Session already
							 * committed; that is a successful cleanup, not a failure. */
							probe({ phase: message.includes("already committed") ? "restore-already-sent" : "restore-read-failed", draftId: entry.draftId, message });
						}
					}
					if (files.length === 0) return;
					if (composer === undefined || composer.sessionId !== active.sessionId) return;
					let drafts;
					try {
						drafts = conversation.createDrafts(active.sessionId, files);
					} catch (error) {
						probe({ phase: "restore-create-failed", message: error instanceof Error ? error.message : String(error) });
						return;
					}
					if (composer === undefined || composer.sessionId !== active.sessionId) {
						for (const draft of drafts) conversation.releaseDraftAttachment(draft.id);
						return;
					}
					const added = active.inputActions.addAttachments(drafts.map((draft) => draft.id));
					if (added !== true) {
						for (const draft of drafts) conversation.releaseDraftAttachment(draft.id);
						for (const entry of restored) {
							const known = releasedDrafts.get(entry);
							releasedDrafts.set(entry, {
								sessionId: active.sessionId,
								attempts: (known === undefined ? 0 : known.attempts) + 1
							});
						}
						probe({ phase: "restore-blocked", draftIds: restored });
						setTimeout(() => {
							maybeRestore();
						}, 1500);
						return;
					}
					for (const entry of restored) {
						releasedDrafts.delete(entry);
						restoredDrafts.add(entry);
					}
					probe({ phase: "restore-done", sessionId: active.sessionId, draftIds: restored });
					setTimeout(() => {
						postJson(`${API}/discard`, { draftIds: restored }).then(() => {
							probe({ phase: "restore-discarded-old", draftIds: restored });
							refresh();
						}).catch(() => {});
					}, 1500);
				}).catch((error) => {
					probe({ phase: "restore-failed", message: error instanceof Error ? error.message : String(error) });
				}).finally(() => {
					restoring = false;
				});
			};

			/** Open the Host storage folder in the OS file manager. */
			const reveal = () => {
				postJson(`${API}/reveal`, {}).catch(() => {});
			};

			const guard = {
				summary,
				observeAttachments,
				saveText,
				discardDroppedImages,
				discardTextHashes,
				scheduleReleasedCheck,
				attachComposer,
				detachComposer,
				maybeRestore,
				refresh,
				reveal
			};
			guard.probeRender = () => {
				if (renderProbed) return;
				renderProbed = true;
				const conversation = ctx.get("conversation");
				probe({ phase: "render", conversation: conversation !== undefined && typeof conversation.resolveDraftAttachments === "function" });
			};
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "unsent-content-guard: browser dictionaries");
			ctx.effect(() => {
				const timer = setTimeout(() => {
					const conversation = ctx.get("conversation");
					probe({
						phase: "activate",
						conversation: conversation !== undefined && typeof conversation.resolveDraftAttachments === "function"
					});
				}, 2000);
				return () => {
					clearTimeout(timer);
				};
			}, "unsent-content-guard: activation probe");
			refresh();
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "unsent-content-guard",
				order: 2,
				locale: NS,
				inject: () => ({ guard })
			}, UnsentContentEntry));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
