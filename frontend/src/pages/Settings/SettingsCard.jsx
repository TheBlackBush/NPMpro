import { cn } from "src/lib/utils";

/**
 * The bordered card of a Settings section for one group of fields: an optional header (title and description on the
 * left, actions on the right), then the body that spaces its children.
 *
 * @param {Object}          props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions]    right aligned in the header
 * @param {string}          [props.className]  of the card
 */
function SettingsCard({ title, description, actions, children, className }) {
	const hasHeader = Boolean(title || description || actions);
	return (
		<div className={cn("rounded-lg border bg-card text-card-foreground", className)}>
			{hasHeader ? (
				<div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
					<div className="min-w-0">
						{title ? <h3 className="text-base font-medium">{title}</h3> : null}
						{description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
					</div>
					{actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
				</div>
			) : null}
			<div className="space-y-4 p-4">{children}</div>
		</div>
	);
}

export { SettingsCard };
