import { createContext, useContext, useEffect } from "react";
import { useFormState } from "react-hook-form";
import { AppModal, Button } from "src/components";
import { usePendingEntries } from "src/components/Form/HookForm";
import { intl, T } from "src/locale";
import { ACCOUNT_PARTS, otherDirtyPart } from "src/modules/AccountWindow";

/**
 * What the Account frame gives its parts: report(id, state), close() (asks with unsaved changes), the frame state
 * (dirtyParts, locked, busy, closable), and the part whose heading starts the window (startHeading, or null)
 */
export const AccountContext = createContext(null);

/** Tells the frame a part's state; a part that unmounts (a token step that ends) reports idle */
export function usePartReport(id, { dirty = false, locked = false, busy = false }) {
	const { report } = useContext(AccountContext);
	useEffect(() => {
		report(id, { dirty, locked, busy });
	}, [report, id, dirty, locked, busy]);
	useEffect(() => () => report(id, {}), [report, id]);
}

/** Inside a part's HookForm: its changes (typed text that is not a value yet counts) and a running save */
export function PartFormReport({ id }) {
	const { isDirty, isSubmitting } = useFormState();
	const pending = usePendingEntries().size > 0;
	usePartReport(id, { dirty: isDirty || pending, busy: isSubmitting });
	return null;
}

// Close on the left (hidden while a step only Done ends, disabled while a request runs), the note naming another
// part with unsaved changes, then the part's own buttons on the right
function PartFooter({ id, children }) {
	const { close, frame } = useContext(AccountContext);
	const other = otherDirtyPart(frame.dirtyParts, id);
	const otherLabel = ACCOUNT_PARTS.find((part) => part.id === other)?.labelId;
	return (
		<AppModal.Footer className="flex-nowrap">
			{frame.locked ? null : (
				<Button onClick={close} disabled={frame.busy}>
					<T id="action.close" />
				</Button>
			)}
			{otherLabel ? (
				<p
					className="m-0 hidden min-w-0 items-center gap-1.5 truncate text-muted-foreground text-xs sm:flex"
					data-account-unsaved-note=""
				>
					<span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
					<T id="account.unsaved-part" data={{ part: intl.formatMessage({ id: otherLabel }) }} />
				</p>
			) : null}
			<div className="ms-auto flex shrink-0 items-center gap-2">{children}</div>
		</AppModal.Footer>
	);
}

/**
 * One part of the Account window: its heading (focusable, tabIndex -1; it starts the window when the frame says so,
 * and a step focuses it through headingRef), the scrolling body (a container for @md classes) and its footer
 *
 * @param {Object}   props
 * @param {string}   props.id
 * @param {Function} props.icon        a lucide icon
 * @param {*}        props.heading
 * @param {Object}   [props.headingRef]
 * @param {*}        [props.footer]    the part's buttons, right of Close
 * @param {*}        props.children
 */
export function AccountPart({ id, icon: Icon, heading, headingRef, footer, children }) {
	const { startHeading } = useContext(AccountContext);
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-account-part={id}>
			<div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
				<h3
					ref={headingRef}
					tabIndex={-1}
					className="m-0 flex min-w-0 items-center gap-2 font-semibold text-base outline-none"
					{...(startHeading === id ? { "data-window-start": "" } : {})}
				>
					<Icon className="size-5 shrink-0" aria-hidden="true" />
					{heading}
				</h3>
			</div>
			<div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
			<PartFooter id={id}>{footer}</PartFooter>
		</div>
	);
}
