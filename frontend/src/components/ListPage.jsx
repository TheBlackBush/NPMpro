import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { HelpButton } from "src/modals";
import { sectionAccent } from "src/modules/SectionAccents";
import { sectionIcon } from "src/shell/useNavItems";

/**
 * The frame of a list page: the title with the item count and the help button, the page actions on the right, then
 * one bordered card that holds the toolbar and the table.
 *
 * @param {Object}      props
 * @param {React.ReactNode} props.title     the page title
 * @param {string}      [props.section]     the section key (SectionColors.js): shows its menu icon before the title and
 *   tints the count badge in its accent colour
 * @param {number}      [props.count]       number of items, shown as a muted badge after the title
 * @param {string}      [props.help]        help document name for the HelpButton
 * @param {React.ReactNode} [props.actions] page actions (import/export, add), right aligned
 * @param {React.ReactNode} [props.tabs]    a row of tab links between the header and the card
 * @param {React.ReactNode} [props.toolbar] the ListToolbar
 * @param {React.ReactNode} props.children  the table
 */
function ListPage({ title, section, count, help, actions, tabs, toolbar, children }) {
	const accent = sectionAccent(section);
	const Icon = sectionIcon(section);
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					{Icon ? <Icon className={cn("size-6 shrink-0", accent.text)} aria-hidden="true" /> : null}
					{/* Focusable from code: focus returns here when a closed window's row is gone (FocusReturn) */}
					<h1 className="text-2xl font-semibold tracking-tight outline-none" tabIndex={-1} data-list-heading>
						{title}
					</h1>
					{count !== undefined ? (
						// the number is shown, the full text ("6 items") is what screen readers read
						<Badge variant="secondary" className={section ? cn(accent.bg, "text-foreground") : undefined}>
							{section ? (
								<span
									className={cn("size-1.5 rounded-full bg-current", accent.text)}
									aria-hidden="true"
								/>
							) : null}
							<span aria-hidden="true">{count}</span>
							<span className="sr-only">{intl.formatMessage({ id: "list.count" }, { count })}</span>
						</Badge>
					) : null}
					{help ? <HelpButton doc={help} /> : null}
				</div>
				{actions ? (
					<div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
				) : null}
			</div>
			{tabs ? <div className="mb-3">{tabs}</div> : null}
			<div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
				{toolbar}
				{children}
			</div>
		</section>
	);
}

export { ListPage };
