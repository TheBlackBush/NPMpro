import { useEffect } from "react";
import { useFormState } from "react-hook-form";
import { askDiscard } from "src/modals/DiscardChangesModal";

let guards = 0;

/**
 * For navigation that is not a link click (a select, a button calling navigate): resolves true when nothing is
 * unsaved or the user agrees to leave. Same prompt as the link guard.
 *
 * @returns {Promise<boolean>}
 */
const confirmLeave = async () => guards === 0 || (await askDiscard("unsaved-changes.leave"));

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
		// the link the user agreed to leave through: its click is replayed once and passes
		let replaying = false;
		const onClick = (event) => {
			if (replaying || event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
			const url = new URL(link.href, window.location.href);
			if (url.origin !== window.location.origin) return;
			// tabs and in-page anchors stay on the page
			if (url.pathname === window.location.pathname && url.search === window.location.search) return;
			// the themed prompt cannot block: stop the click, replay it when the user agrees
			event.preventDefault();
			event.stopPropagation();
			void askDiscard("unsaved-changes.leave").then((leave) => {
				if (!leave) return;
				replaying = true;
				link.click();
				replaying = false;
			});
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
