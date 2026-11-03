import { cn } from "src/lib/utils";

/**
 * The bordered card of a Settings section for one group of fields: an optional header (title and description on the
 * left, actions on the right), then the body that spaces its children.
 *
 * @param {Object}          props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions]    right aligned in the header
 * @param {React.ReactNode} [props.footer]     a bar after the body (notes on the left, the card's primary button)
 * @param {string}          [props.className]  of the card
 * @param {string}          [props.bodyClassName]  of the body ("p-0" for a table that runs edge to edge)
 */
function SettingsCard({ title, description, actions, footer, children, className, bodyClassName }) {
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
			<div className={cn("space-y-4 p-4", bodyClassName)}>{children}</div>
			{footer ? (
				<div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">{footer}</div>
			) : null}
		</div>
	);
}

export { SettingsCard };
