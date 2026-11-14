import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useFormState } from "react-hook-form";
import { cn } from "src/lib/utils";
import { openOnRefusedSave, settingsCardClass } from "src/modules/SettingLayout";

// the drawn card: the title bar (title and description, actions, the chevron of a collapsible card), the body, notes
function CardFrame({
	baseId,
	title,
	description,
	actions,
	footer,
	children,
	className,
	bodyClassName,
	lines,
	collapsible,
	open,
	onToggle,
}) {
	const card = settingsCardClass({ lines, open, collapsible });
	const titleId = `${baseId}-title`;
	const descriptionId = `${baseId}-description`;
	const hasHeader = Boolean(title || description || actions);
	// a titled card is a group named by its title and described by its description
	const group = title
		? { role: "group", "aria-labelledby": titleId, "aria-describedby": description ? descriptionId : undefined }
		: {};
	return (
		<div {...group} className={cn(card.card, className)}>
			{hasHeader ? (
				<div className={card.header}>
					<div className="min-w-0 flex-1">
						{title ? (
							<h3 id={titleId} className="text-base font-medium">
								{collapsible ? (
									<button
										type="button"
										id={`${baseId}-trigger`}
										aria-expanded={open}
										aria-controls={`${baseId}-panel`}
										onClick={onToggle}
										className={card.trigger}
									>
										{title}
									</button>
								) : (
									title
								)}
							</h3>
						) : null}
						{description ? (
							<p id={descriptionId} className="text-sm text-muted-foreground">
								{description}
							</p>
						) : null}
					</div>
					{actions ? (
						// above the stretched trigger, so the actions keep their own clicks
						<div className="relative z-10 ml-auto flex flex-wrap items-center justify-end gap-2">
							{actions}
						</div>
					) : null}
					{collapsible ? (
						<ChevronDown
							aria-hidden="true"
							className={cn(
								"size-4 shrink-0 text-muted-foreground transition-transform",
								open && "rotate-180",
							)}
						/>
					) : null}
				</div>
			) : null}
			{collapsible ? (
				// stays mounted while closed: the fields in it keep their values and registration
				<section
					id={`${baseId}-panel`}
					aria-labelledby={`${baseId}-trigger`}
					hidden={!open}
					className={cn(card.body, bodyClassName)}
				>
					{children}
				</section>
			) : (
				<div className={cn(card.body, bodyClassName)}>{children}</div>
			)}
			{footer && open ? (
				<div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">{footer}</div>
			) : null}
		</div>
	);
}

// a collapsible card on its own state, or on the caller's (open, onOpenChange)
function ToggleCard({ defaultOpen, open: openProp, onOpenChange, ...props }) {
	const [ownOpen, setOwnOpen] = useState(defaultOpen);
	const open = openProp ?? ownOpen;
	const onToggle = () => {
		if (openProp === undefined) setOwnOpen(!open);
		onOpenChange?.(!open);
	};
	return <CardFrame {...props} collapsible open={open} onToggle={onToggle} />;
}

// a collapsible card in a form that a refused save opens when one of openOn holds an error (while rendering, so it is
// open when HookForm focuses the first error)
function OpeningCard({ defaultOpen, openOn, ...props }) {
	const { errors, submitCount } = useFormState({ name: openOn });
	const [state, setState] = useState(() => ({ open: defaultOpen, seenSubmits: submitCount }));
	const next = openOnRefusedSave(state, { submitCount, errors, names: openOn });
	if (next !== state) setState(next);
	return (
		<CardFrame {...props} collapsible open={next.open} onToggle={() => setState({ ...next, open: !next.open })} />
	);
}

/**
 * The bordered card of a Settings section: a title bar (title and description on the left, the card's actions on
 * the right, and the chevron of a collapsible card), a divider, then the body: padded, or lines edge to edge with a
 * hairline between them (lines). A collapsible card is closed by default; with openOn a refused save that has an
 * error in one of those fields opens it.
 *
 * @param {Object}          props
 * @param {string}          [props.id]           base of the ids (-title, -description, -trigger, -panel)
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.description]  one line under the title
 * @param {React.ReactNode} [props.actions]      buttons that act at once, right aligned in the title bar
 * @param {React.ReactNode} [props.footer]       notes after the body (no buttons)
 * @param {string}          [props.className]    of the card
 * @param {string}          [props.bodyClassName] of the body ("p-0" for a table that runs edge to edge)
 * @param {boolean}         [props.lines]        the body holds SettingLine lines
 * @param {boolean}         [props.collapsible]
 * @param {boolean}         [props.defaultOpen]
 * @param {boolean}         [props.open]         controlled (with onOpenChange)
 * @param {Function}        [props.onOpenChange] (open) => void
 * @param {string[]}        [props.openOn]       field names; needs a form around the card
 */
function SettingsCard({
	id,
	collapsible = false,
	defaultOpen = false,
	open,
	onOpenChange,
	openOn,
	lines = false,
	...props
}) {
	const autoId = useId();
	const baseId = id ?? autoId;
	if (!collapsible) return <CardFrame {...props} baseId={baseId} lines={lines} collapsible={false} open />;
	if (openOn)
		return <OpeningCard {...props} baseId={baseId} lines={lines} defaultOpen={defaultOpen} openOn={openOn} />;
	return (
		<ToggleCard
			{...props}
			baseId={baseId}
			lines={lines}
			defaultOpen={defaultOpen}
			open={open}
			onOpenChange={onOpenChange}
		/>
	);
}

export { SettingsCard };
