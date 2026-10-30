import { useEffect } from "react";
import { useFormState } from "react-hook-form";
import { intl } from "src/locale";

let guards = 0;

/**
 * For navigation that is not a link click (a select, a button calling navigate): true when nothing is unsaved
 * or the user agrees to leave. Same prompt as the link guard.
 *
 * @returns {boolean}
 */
const confirmLeave = () => {
	// biome-ignore lint/suspicious/noAlert: a blocking confirm is enough for this guard (as in useUnsavedChangesGuard)
	return guards === 0 || window.confirm(intl.formatMessage({ id: "unsaved-changes.leave" }));
};

/**
 * Asks before leaving the page while dirty: links inside the app (the click is cancelled before React Router sees it,
 * BrowserRouter has no navigation blocker) and reloading or closing the tab (the browser's own prompt).
 * The browser's back button is not covered. For navigation that is not a link click (a select or button calling
 * navigate), ask with confirmLeave() first.
 *
 * @param {boolean} dirty
 */
const useLeaveGuard = (dirty) => {
	useEffect(() => {
		if (!dirty) return;
		guards += 1;
		const onClick = (event) => {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
			const url = new URL(link.href, window.location.href);
			if (url.origin !== window.location.origin) return;
			// tabs and in-page anchors stay on the page
			if (url.pathname === window.location.pathname && url.search === window.location.search) return;
			// biome-ignore lint/suspicious/noAlert: a blocking confirm is enough for this guard (as in useUnsavedChangesGuard)
			if (!window.confirm(intl.formatMessage({ id: "unsaved-changes.leave" }))) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		const onBeforeUnload = (event) => {
			event.preventDefault();
		};
		document.addEventListener("click", onClick, true);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			guards -= 1;
			document.removeEventListener("click", onClick, true);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [dirty]);
};

/**
 * Place inside a HookForm: asks before leaving the page with unsaved changes (useLeaveGuard), not while a save runs
 */
function LeaveGuard() {
	const { isDirty, isSubmitting } = useFormState();
	useLeaveGuard(isDirty && !isSubmitting);
	return null;
}

export { confirmLeave, LeaveGuard, useLeaveGuard };
