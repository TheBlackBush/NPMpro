import { useFormikContext } from "formik";
import { useEffect } from "react";
import { intl } from "src/locale";

/**
 * Asks before leaving the page while dirty: links inside the app (the click is cancelled before React Router sees it,
 * BrowserRouter has no navigation blocker) and reloading or closing the tab (the browser's own prompt).
 * The browser's back button is not covered.
 *
 * @param {boolean} dirty
 */
const useLeaveGuard = (dirty) => {
	useEffect(() => {
		if (!dirty) return;
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
			document.removeEventListener("click", onClick, true);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [dirty]);
};

/**
 * Place inside a Formik form: asks before leaving the page with unsaved changes (useLeaveGuard)
 */
function LeaveGuard() {
	const { dirty, isSubmitting } = useFormikContext();
	useLeaveGuard(dirty && !isSubmitting);
	return null;
}

export { LeaveGuard, useLeaveGuard };
