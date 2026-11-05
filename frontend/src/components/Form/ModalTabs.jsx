import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-hook-form";
import { Badge } from "src/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "src/components/ui/tabs";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { tabErrorCounts } from "src/modules/ModalTabs";
import { useFormTabs, useReadOnly } from "./HookForm";

const NO_ENTRIES = {};

/**
 * The count of a tab's errors; screen readers read it as the tab's description (ErrorDescription), so it is hidden
 * from them
 *
 * @param {Object} props
 * @param {number} props.count
 */
function ErrorBadge({ count }) {
	return count > 0 ? (
		<Badge variant="destructive" className="h-4 min-w-4 px-1" aria-hidden="true">
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

/**
 * The tabs of a window's form (shadcn Tabs on Radix): one row that never wraps and scrolls sideways when the tabs do
 * not fit (phones), every tab with a shown error gets a red badge
 * with the count. Inside a HookForm, "jump to the first error" opens the tab that holds it and keeps it in view.
 * Every pane stays mounted, so its fields keep their values and can be focused. Keyboard (Radix): Tab reaches the
 * open tab, the arrow keys (and Home, End) move between the tabs and open them.
 *
 * @param {Object}   props
 * @param {Object[]} props.tabs        { id, labelId, fields } (modules/ModalTabs.js), in order
 * @param {Object}   [props.markers]   tab id -> what follows the label (the "*" of a tab that holds settings)
 * @param {Object}   [props.disabled]  tab id -> true while the tab cannot be opened
 * @param {*}        props.children    a TabPane for every tab
 */
function ModalTabs({ tabs, markers = NO_ENTRIES, disabled = NO_ENTRIES, children }) {
	const baseId = useId();
	const [active, setActive] = useState(tabs[0].id);
	const { errors } = useFormState();
	const registry = useFormTabs();
	const listRef = useRef(null);
	const activeRef = useRef(active);
	const disabledRef = useRef(disabled);
	const pendingFocus = useRef(null);
	// whether tabs lie beyond the start or the end of the scrolling row: a fade at that edge shows there is more
	const [more, setMore] = useState({ start: false, end: false });
	const errorIds = useMemo(() => ({ of: (id) => `${baseId}-errors-${id}` }), [baseId]);
	const counts = tabErrorCounts(tabs, errors);

	// after a tab opened for "jump to the first error": its pane shows, so the field can take the focus
	useLayoutEffect(() => {
		activeRef.current = active;
		disabledRef.current = disabled;
		const focus = pendingFocus.current;
		pendingFocus.current = null;
		focus?.();
	});

	// the open tab stays in view in the sideways scrolling row (a jump to an error opens a tab that may be off screen)
	useEffect(() => {
		listRef.current?.querySelector(`[role="tab"][data-tab="${active}"]`)?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [active]);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const update = () => {
			const start = list.scrollLeft > 1;
			const end = Math.ceil(Math.abs(list.scrollLeft)) + list.clientWidth < list.scrollWidth - 1;
			setMore((current) => (current.start === start && current.end === end ? current : { start, end }));
		};
		update();
		list.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(list);
		return () => {
			list.removeEventListener("scroll", update);
			observer.disconnect();
		};
	}, []);

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

	return (
		<Tabs value={active} onValueChange={setActive} className="mb-3 gap-3">
			<TabsList
				ref={listRef}
				variant="line"
				// shadcn sets the row to h-8 for horizontal tabs (a group variant that outranks a plain h-auto); the tabs are h-9, so
				// the scrolling row clipped their active underline
				className={cn(
					"h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b p-0 group-data-[orientation=horizontal]/tabs:h-auto",
					// a fade (a mask) at the edge that has more tabs behind it
					more.end && !more.start && "mask-r-from-85%",
					more.start && !more.end && "mask-l-from-85%",
					more.start && more.end && "mask-x-from-85%",
				)}
			>
				{tabs.map((tab) => (
					<TabsTrigger
						key={tab.id}
						value={tab.id}
						data-tab={tab.id}
						disabled={Boolean(disabled[tab.id])}
						aria-describedby={counts[tab.id] > 0 ? errorIds.of(tab.id) : undefined}
						className="h-9 flex-none rounded-none px-3 after:bottom-0! after:h-0.5 after:bg-primary"
					>
						<T id={tab.labelId} />
						{markers[tab.id]}
						<ErrorBadge count={counts[tab.id]} />
						<ErrorDescription id={errorIds.of(tab.id)} count={counts[tab.id]} />
					</TabsTrigger>
				))}
			</TabsList>
			{children}
		</Tabs>
	);
}

/**
 * One tab's pane. In a read-only form (a View window) its fields sit in a disabled fieldset; selfReadOnly: the
 * pane's fields handle that themselves (the custom locations, whose cards still open and close; the nginx config
 * fields, read-only textareas that can still be focused and scrolled)
 *
 * @param {Object}  props
 * @param {string}  props.id
 * @param {boolean} [props.selfReadOnly]
 * @param {*}       props.children
 */
function TabPane({ id, selfReadOnly = false, children }) {
	const readOnly = useReadOnly();
	return (
		<TabsContent
			value={id}
			forceMount
			// forceMount keeps every pane mounted, and Radix then never sets hidden on the inactive ones
			className="rounded-md text-base focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=inactive]:hidden"
		>
			{readOnly && !selfReadOnly ? <fieldset disabled>{children}</fieldset> : children}
		</TabsContent>
	);
}

export { ModalTabs, TabPane };
