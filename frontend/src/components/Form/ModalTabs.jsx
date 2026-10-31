import { Dropdown, NavOverflow } from "@tabler/core";
import { IconDots } from "@tabler/icons-react";
import cn from "clsx";
import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-hook-form";
import { useModalHide } from "src/components/AppModal";
import { intl, T } from "src/locale";
import { errorCountOf, nextTabId, tabErrorCounts, tabStopId } from "src/modules/ModalTabs";
import { useFormTabs } from "./HookForm";

const PaneContext = createContext({ active: null, ids: null });
const NO_ENTRIES = {};
// what a tab's copy in the More menu drops: it is a menu entry there, not a tab
const TAB_ATTRIBUTES = ["role", "aria-selected", "aria-controls", "tabindex"];

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

// the tab buttons of the row (not their copies in the More menu)
const tabButtons = (nav) => [...nav.querySelectorAll(':scope > .nav-item > [role="tab"]')];

// an attribute set to value, or removed for null
const setAttribute = (element, name, value) => {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
};

// a copy in the More menu made like its tab again: label, marker and badge, open, disabled, the error count read by
// screen readers; without the tab's own attributes, as it is a menu entry there
function syncCopy(copy, tab) {
	copy.replaceChildren(...[...tab.childNodes].map((node) => node.cloneNode(true)));
	for (const name of TAB_ATTRIBUTES) copy.removeAttribute(name);
	const open = tab.classList.contains("active");
	copy.classList.toggle("active", open);
	setAttribute(copy, "aria-current", open ? "true" : null);
	copy.disabled = tab.disabled;
	copy.classList.toggle("disabled", tab.disabled);
	setAttribute(copy, "aria-describedby", tab.getAttribute("aria-describedby"));
}

/**
 * Brings the copies NavOverflow made in the More menu up to date with their tabs
 *
 * @param {HTMLElement} menu
 * @param {HTMLElement} nav
 */
function syncMenu(menu, nav) {
	const tabs = new Map(tabButtons(nav).map((button) => [button.dataset.tab, button]));
	for (const copy of menu.querySelectorAll("[data-tab]")) {
		const tab = tabs.get(copy.dataset.tab);
		if (tab) syncCopy(copy, tab);
	}
}

// the element a mutation record is about
const elementOf = (record) =>
	record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;

// a change inside a tab button (label, marker, badge, disabled, the open tab's class): the More menu copies it
const touchesTab = (record, menu) => {
	const element = elementOf(record);
	return Boolean(element) && !menu.contains(element) && element.closest('[role="tab"]') !== null;
};

// a change that can alter the width of the row, so the tabs are measured again: inside a tab button or in the content
// of the More toggle (its badge), not in the More menu, on the items, or the class of a tab button (opening another tab
// changes no width)
const changesWidth = (record, menu) => {
	const element = elementOf(record);
	if (!element || menu.contains(element)) return false;
	if (element.closest(".nav-overflow-toggle") !== null) return record.type !== "attributes";
	if (!touchesTab(record, menu)) return false;
	return !(record.type === "attributes" && record.attributeName === "class" && element.matches('[role="tab"]'));
};

/**
 * The red count of a tab's errors; screen readers read the count as the tab's description
 *
 * @param {Object} props
 * @param {number} props.count
 */
function ErrorBadge({ count }) {
	return count > 0 ? (
		<span className="badge bg-red text-red-fg ms-2" aria-hidden="true">
			{count}
		</span>
	) : null;
}

// the text a tab's badge stands for ("2 errors"), the tab's aria-describedby
function ErrorDescription({ id, count }) {
	return count > 0 ? (
		<span id={id} hidden>
			{intl.formatMessage({ id: "form.tabs.errors" }, { count })}
		</span>
	) : null;
}

/**
 * The tabs of a window's form (Tabler's tabs, driven by React): one row that never wraps, the tabs that do not fit
 * move into a "More" menu (Tabler's nav-overflow, created and disposed here), a tab with end set sits on the right
 * (Advanced), every tab with a shown error gets a red badge with the count (More with the count of its tabs). Inside
 * a HookForm, "jump to the first error" opens the tab that holds it (also one in More). Every pane stays mounted, so
 * its fields keep their values and can be focused. Keyboard as Tabler's tabs: Tab reaches the open tab, the arrow
 * keys (and Home, End) move between the tabs of the row and open them, Enter and Space open the focused tab.
 *
 * @param {Object}   props
 * @param {Object[]} props.tabs        { id, labelId, fields, end? } (modules/ModalTabs.js), in order
 * @param {Object}   [props.markers]   tab id -> what follows the label (the "*" of a tab that holds settings)
 * @param {Object}   [props.disabled]  tab id -> true while the tab cannot be opened
 * @param {*}        props.children    a TabPane for every tab
 */
function ModalTabs({ tabs, markers = NO_ENTRIES, disabled = NO_ENTRIES, children }) {
	const baseId = useId();
	const [active, setActive] = useState(tabs[0].id);
	// the tabs NavOverflow moved into the More menu
	const [moved, setMoved] = useState([]);
	const { errors } = useFormState();
	const registry = useFormTabs();
	const hide = useModalHide();
	const wrapperRef = useRef(null);
	const navRef = useRef(null);
	const menuRef = useRef(null);
	const toggleRef = useRef(null);
	const activeRef = useRef(active);
	const disabledRef = useRef(disabled);
	const pendingFocus = useRef(null);

	// the ids of a tab, its pane and the text of its badge
	const ids = useMemo(
		() => ({
			tab: (id) => `${baseId}-tab-${id}`,
			pane: (id) => `${baseId}-pane-${id}`,
			errors: (id) => `${baseId}-errors-${id}`,
		}),
		[baseId],
	);
	const counts = tabErrorCounts(tabs, errors);
	const moreCount = errorCountOf(counts, moved);
	const reachable = tabs.filter((tab) => !(disabled[tab.id] || moved.includes(tab.id))).map((tab) => tab.id);
	const tabStop = tabStopId(reachable, active);
	const pane = useMemo(() => ({ active, ids }), [active, ids]);

	// after a tab opened for "jump to the first error": its pane shows, so the field can take the focus
	useLayoutEffect(() => {
		activeRef.current = active;
		disabledRef.current = disabled;
		const focus = pendingFocus.current;
		pendingFocus.current = null;
		focus?.();
	});

	// More looks open while the open tab sits in its menu. Set here, not in React's className: React would drop the
	// "show" class Bootstrap's dropdown puts on the toggle, and the menu would no longer close
	useLayoutEffect(() => {
		toggleRef.current.classList.toggle("active", moved.includes(active));
	}, [moved, active]);

	// HookForm opens the tab of the first error through this
	useLayoutEffect(() => {
		if (!registry) return;
		registry.current = {
			tabs,
			open: (id, then) => {
				if (id === activeRef.current || disabledRef.current[id]) {
					then?.();
					return;
				}
				pendingFocus.current = then ?? null;
				setActive(id);
			},
		};
		return () => {
			registry.current = null;
		};
	}, [registry, tabs]);

	// Tabler's nav-overflow on the row; a tab whose label, badge or state changes is measured again and its copy
	// in the More menu follows
	useLayoutEffect(() => {
		const wrapper = wrapperRef.current;
		const nav = navRef.current;
		const menu = menuRef.current;
		const overflow = new NavOverflow(wrapper);
		const readMoved = () => {
			const inMenu = tabButtons(nav)
				.filter((button) => button.parentElement.dataset.bsNavOverflow === "true")
				.map((button) => button.dataset.tab);
			setMoved((current) => (sameList(current, inMenu) ? current : inMenu));
		};
		const onOverflow = () => syncMenu(menu, nav);
		const observer = new MutationObserver((records) => {
			if (records.some((record) => changesWidth(record, menu))) overflow.update();
			if (records.some((record) => touchesTab(record, menu))) syncMenu(menu, nav);
			readMoved();
		});
		wrapper.addEventListener("overflow.bs.navoverflow", onOverflow);
		observer.observe(nav, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["class", "disabled", "aria-describedby", "data-bs-nav-overflow"],
		});
		syncMenu(menu, nav);
		readMoved();
		return () => {
			observer.disconnect();
			wrapper.removeEventListener("overflow.bs.navoverflow", onOverflow);
			overflow.dispose();
		};
	}, []);

	const onKeyDown = (event) => {
		if (event.target.getAttribute("role") !== "tab") return;
		const next = nextTabId(reachable, event.target.dataset.tab, event.key);
		if (next === null) return;
		event.preventDefault();
		setActive(next);
		navRef.current.querySelector(`[role="tab"][data-tab="${next}"]`)?.focus();
	};

	// a copy in the More menu (NavOverflow's, without React's handlers) opens its tab; the focus goes back to More
	const onMenuClick = (event) => {
		const copy = event.target.closest("[data-tab]");
		if (!copy || copy.disabled) return;
		Dropdown.getInstance(toggleRef.current)?.hide();
		setActive(copy.dataset.tab);
		toggleRef.current.focus();
	};

	// Bootstrap's dropdown prevents the default of every Escape on its toggle, even with the menu closed, and the window
	// then ignores the key. With the menu closed (the focus goes back to More after a pick) Escape closes the window
	// (when it can close); with the menu open Bootstrap closes only the menu
	const onToggleKeyDown = (event) => {
		if (event.key !== "Escape" || event.currentTarget.getAttribute("aria-expanded") !== "false") return;
		event.stopPropagation();
		hide?.();
	};

	return (
		<PaneContext.Provider value={pane}>
			<div ref={wrapperRef} className="nav-overflow mb-3">
				{/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: Tabler's tab markup, the list of tabs is the tablist (Bootstrap's Tab gives it the same role) */}
				<ul ref={navRef} className="nav nav-tabs" role="tablist" onKeyDown={onKeyDown}>
					{tabs.map((tab) => (
						<li key={tab.id} className={cn("nav-item", tab.end && "ms-auto")} role="presentation">
							<button
								id={ids.tab(tab.id)}
								type="button"
								className={cn("nav-link", tab.id === active && "active")}
								role="tab"
								data-tab={tab.id}
								aria-selected={tab.id === active}
								aria-controls={ids.pane(tab.id)}
								aria-describedby={counts[tab.id] > 0 ? ids.errors(tab.id) : undefined}
								tabIndex={tab.id === tabStop ? 0 : -1}
								disabled={Boolean(disabled[tab.id])}
								onClick={() => setActive(tab.id)}
							>
								<T id={tab.labelId} />
								{markers[tab.id]}
								<ErrorBadge count={counts[tab.id]} />
							</button>
							<ErrorDescription id={ids.errors(tab.id)} count={counts[tab.id]} />
						</li>
					))}
					<li className="nav-item dropdown nav-overflow-item" role="presentation">
						<button
							ref={toggleRef}
							type="button"
							className="nav-link nav-overflow-toggle"
							data-bs-toggle="dropdown"
							aria-expanded="false"
							onKeyDown={onToggleKeyDown}
							aria-describedby={moreCount > 0 ? ids.errors("more") : undefined}
						>
							<span className="nav-overflow-icon">
								<IconDots className="icon" aria-hidden="true" />
							</span>
							<span className="nav-overflow-text">
								<T id="form.tabs.more" />
							</span>
							<ErrorBadge count={moreCount} />
						</button>
						<ErrorDescription id={ids.errors("more")} count={moreCount} />
						{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions lint/a11y/useKeyWithClickEvents: NavOverflow fills the menu with button copies of the tabs that do not fit; their clicks (also Enter and Space) bubble here */}
						<div
							ref={menuRef}
							className="dropdown-menu dropdown-menu-end nav-overflow-menu"
							onClick={onMenuClick}
						/>
					</li>
				</ul>
			</div>
			<div className="tab-content">{children}</div>
		</PaneContext.Provider>
	);
}

/**
 * The pane of one tab of a ModalTabs; it stays mounted while another tab is open
 *
 * @param {Object} props
 * @param {string} props.id  the tab's id
 * @param {*}      props.children
 */
function TabPane({ id, children }) {
	const { active, ids } = useContext(PaneContext);
	return (
		<div
			className={cn("tab-pane", id === active && "active show")}
			id={ids?.pane(id)}
			role="tabpanel"
			aria-labelledby={ids?.tab(id)}
		>
			{children}
		</div>
	);
}

export { ModalTabs, TabPane };
