import { cn } from "cn";
import { Ellipsis } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useFormState } from "react-hook-form";
import { intl, T } from "src/locale";
import { errorCountOf, tabErrorCounts, tabsInMenu } from "src/modules/ModalTabs";
import { Badge } from "src/ui/badge";
import { Button } from "src/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "src/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "src/ui/tabs";
import { useFormTabs, useReadOnly } from "./HookForm";

const NO_ENTRIES = {};
// the gap between two tabs of the row (TabsList, variant line: tw:gap-1)
const ROW_GAP = 4;
// the tabs' own box: the same in the row and in the measuring copy, so the copy measures what the row shows
const TAB_BOX = "tw:px-3 tw:text-sm tw:font-medium";

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The red count of a tab's errors; screen readers read the count as the tab's description
 *
 * @param {Object} props
 * @param {number} props.count
 */
function ErrorBadge({ count }) {
	return count > 0 ? (
		<Badge variant="destructive" aria-hidden="true">
			{count}
		</Badge>
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

/** A tab's label, its marker and its error count, in the row, in More and in the measuring copy */
function TabLabel({ tab, marker, count }) {
	return (
		<>
			<T id={tab.labelId} />
			{marker}
			<ErrorBadge count={count} />
		</>
	);
}

/**
 * The tabs of a window's form on shadcn's Tabs: one row that never wraps, the tabs that do not fit move into a "More"
 * menu (shadcn's DropdownMenu; tabsInMenu decides from a measuring copy of the row), a tab with end set sits on the
 * right (Advanced), every tab with a shown error gets a red badge with the count (More with the count of its tabs).
 * Inside a HookForm, "jump to the first error" opens the tab that holds it (also one in More). Every pane stays
 * mounted, so its fields keep their values and can be focused. Keyboard as Radix's tabs: Tab reaches the open tab, the
 * arrow keys (and Home, End) move between the tabs of the row and open them.
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
	// the tabs in the More menu
	const [moved, setMoved] = useState([]);
	// the window the row is in: More's menu is portalled there
	const [container, setContainer] = useState(null);
	const { errors } = useFormState();
	const registry = useFormTabs();
	const rowRef = useRef(null);
	const copyRef = useRef(null);
	const activeRef = useRef(active);
	const disabledRef = useRef(disabled);
	const pendingFocus = useRef(null);

	const errorsId = (id) => `${baseId}-errors-${id}`;
	const counts = tabErrorCounts(tabs, errors);
	const moreCount = errorCountOf(counts, moved);
	const shown = tabs.filter((tab) => !moved.includes(tab.id));
	const inMenu = tabs.filter((tab) => moved.includes(tab.id));

	// after a tab opened for "jump to the first error": its pane shows, so the field can take the focus
	useLayoutEffect(() => {
		activeRef.current = active;
		disabledRef.current = disabled;
		const focus = pendingFocus.current;
		pendingFocus.current = null;
		focus?.();
	});

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

	// the tabs that fit: measured on the copy of the whole row (every tab with its badge, and More), again whenever
	// the row's width or a tab's width (a label, a badge) changes
	useLayoutEffect(() => {
		const row = rowRef.current;
		const copy = copyRef.current;
		setContainer(row.closest(".modal"));
		const measure = () => {
			const parts = [...copy.children];
			const more = parts.pop();
			const widths = parts.map((part) => ({ id: part.dataset.tab, width: part.offsetWidth }));
			const next = tabsInMenu(widths, row.clientWidth, more.offsetWidth, ROW_GAP);
			setMoved((current) => (sameList(current, next) ? current : next));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		observer.observe(copy);
		return () => observer.disconnect();
	}, []);

	return (
		<Tabs value={active} onValueChange={setActive} className="tw:mb-4 tw:gap-4">
			<div ref={rowRef} className="tw:relative tw:flex tw:min-w-0 tw:items-end tw:border-b">
				<TabsList variant="line" className="tw:h-auto tw:min-w-0 tw:flex-1 tw:justify-start tw:p-0">
					{shown.map((tab) => (
						<TabsTrigger
							key={tab.id}
							value={tab.id}
							disabled={Boolean(disabled[tab.id])}
							aria-describedby={counts[tab.id] > 0 ? errorsId(tab.id) : undefined}
							className={cn("tw:flex-none tw:pb-2", TAB_BOX, tab.end && "tw:ms-auto")}
						>
							<TabLabel tab={tab} marker={markers[tab.id]} count={counts[tab.id]} />
						</TabsTrigger>
					))}
				</TabsList>
				{inMenu.length > 0 ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								data-active={moved.includes(active) || undefined}
								aria-describedby={moreCount > 0 ? errorsId("more") : undefined}
								className="tw:mb-1 tw:shrink-0 tw:text-muted-foreground tw:data-active:text-foreground"
							>
								<Ellipsis aria-hidden="true" />
								<T id="form.tabs.more" />
								<ErrorBadge count={moreCount} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" container={container} className="tw:w-auto tw:min-w-40">
							<DropdownMenuRadioGroup value={active} onValueChange={setActive}>
								{inMenu.map((tab) => (
									<DropdownMenuRadioItem
										key={tab.id}
										value={tab.id}
										disabled={Boolean(disabled[tab.id])}
										aria-describedby={counts[tab.id] > 0 ? errorsId(tab.id) : undefined}
									>
										<TabLabel tab={tab} marker={markers[tab.id]} count={counts[tab.id]} />
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
				{/* the measuring copy: every tab and More, invisible and outside the accessibility tree */}
				<div
					ref={copyRef}
					aria-hidden="true"
					inert
					className="tw:pointer-events-none tw:invisible tw:absolute tw:top-0 tw:left-0 tw:flex tw:whitespace-nowrap"
				>
					{tabs.map((tab) => (
						<span
							key={tab.id}
							data-tab={tab.id}
							className={cn("tw:inline-flex tw:items-center tw:gap-1.5 tw:border", TAB_BOX)}
						>
							<TabLabel tab={tab} marker={markers[tab.id]} count={counts[tab.id]} />
						</span>
					))}
					<span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2.5 tw:text-[0.8rem] tw:font-medium">
						<Ellipsis className="tw:size-3.5" />
						<T id="form.tabs.more" />
						<ErrorBadge count={moreCount} />
					</span>
				</div>
				{tabs.map((tab) => (
					<ErrorDescription key={tab.id} id={errorsId(tab.id)} count={counts[tab.id]} />
				))}
				<ErrorDescription id={errorsId("more")} count={moreCount} />
			</div>
			{children}
		</Tabs>
	);
}

/**
 * One tab's pane (shadcn's TabsContent, kept mounted and hidden while another tab is open). Its fields are the
 * window's own markup, so they sit in an old part again (data-legacy-ui). In a read-only form (a View window) its
 * fields sit in a disabled fieldset; selfReadOnly: the pane's fields handle that themselves (the custom locations,
 * whose cards still open and close; the nginx config fields, read-only textareas that can still be focused and
 * scrolled)
 *
 * @param {Object}  props
 * @param {string}  props.id
 * @param {boolean} [props.selfReadOnly]
 * @param {*}       props.children
 */
function TabPane({ id, selfReadOnly = false, children }) {
	const readOnly = useReadOnly();
	return (
		<TabsContent value={id} forceMount className="tw:data-[state=inactive]:hidden">
			<div data-legacy-ui="">
				{readOnly && !selfReadOnly ? <fieldset disabled>{children}</fieldset> : children}
			</div>
		</TabsContent>
	);
}

export { ModalTabs, TabPane };
