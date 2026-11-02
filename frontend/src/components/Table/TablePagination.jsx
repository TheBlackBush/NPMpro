import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "src/components/ui/button";
import { intl, T } from "src/locale";
import { pageNumbers } from "src/modules/Pagination";

function PageLink({ page, current, onPage }) {
	const active = page === current;
	return (
		<li>
			<Button
				type="button"
				variant={active ? "default" : "ghost"}
				size="icon"
				onClick={() => onPage(page)}
				aria-current={active ? "page" : undefined}
				aria-label={intl.formatMessage({ id: "pagination.page" }, { page: page + 1 })}
			>
				{page + 1}
			</Button>
		</li>
	);
}

/**
 * Pagination for a client-side paginated table, in a card footer with "Showing 1 to 10 of 23". Renders nothing when
 * everything fits on one page.
 *
 * @param {Object}   props
 * @param {number}   props.pageIndex  zero-based current page
 * @param {number}   props.pageSize
 * @param {number}   props.total      rows in all pages
 * @param {Function} props.onPage     (pageIndex) => void
 */
function TablePagination({ pageIndex, pageSize, total, onPage }) {
	const count = Math.ceil(total / pageSize);
	if (count <= 1) return null;
	const from = pageIndex * pageSize + 1;
	const to = Math.min(total, from + pageSize - 1);
	return (
		<div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
			<p className="m-0 text-sm text-muted-foreground">
				<T id="pagination.showing" data={{ from, to, total }} />
			</p>
			<nav className="ml-auto" aria-label={intl.formatMessage({ id: "pagination.label" })}>
				<ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
					<li>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={() => onPage(pageIndex - 1)}
							disabled={pageIndex === 0}
							aria-label={intl.formatMessage({ id: "pagination.previous" })}
						>
							<ChevronLeft aria-hidden="true" />
						</Button>
					</li>
					{pageNumbers(pageIndex, count).map((page, index) =>
						page === null ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity of its own
							<li key={`gap-${index}`} className="px-2 text-muted-foreground" aria-hidden="true">
								…
							</li>
						) : (
							<PageLink key={page} page={page} current={pageIndex} onPage={onPage} />
						),
					)}
					<li>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={() => onPage(pageIndex + 1)}
							disabled={pageIndex >= count - 1}
							aria-label={intl.formatMessage({ id: "pagination.next" })}
						>
							<ChevronRight aria-hidden="true" />
						</Button>
					</li>
				</ul>
			</nav>
		</div>
	);
}

export { TablePagination };
