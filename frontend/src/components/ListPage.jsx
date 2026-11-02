import { Badge } from "src/components/ui/badge";
import { intl } from "src/locale";
import { HelpButton } from "src/modals";

/**
 * The frame of a list page: the title with the item count and the help button, the page actions on the right, then
 * one bordered card that holds the toolbar and the table.
 *
 * @param {Object}      props
 * @param {React.ReactNode} props.title     the page title
 * @param {number}      [props.count]       number of items, shown as a muted badge after the title
 * @param {string}      [props.help]        help document name for the HelpButton
 * @param {React.ReactNode} [props.actions] page actions (import/export, add), right aligned
 * @param {React.ReactNode} [props.toolbar] the ListToolbar
 * @param {React.ReactNode} props.children  the table
 */
function ListPage({ title, count, help, actions, toolbar, children }) {
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					{/* Focusable from code: focus returns here when a closed window's row is gone (FocusReturn) */}
					<h1 className="text-2xl font-semibold tracking-tight outline-none" tabIndex={-1} data-list-heading>
						{title}
					</h1>
					{count !== undefined ? (
						<Badge variant="secondary" aria-label={intl.formatMessage({ id: "list.count" }, { count })}>
							{count}
						</Badge>
					) : null}
					{help ? <HelpButton doc={help} /> : null}
				</div>
				{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
			</div>
			<div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
				{toolbar}
				{children}
			</div>
		</section>
	);
}

export { ListPage };
