import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import cn from "clsx";
import { intl, T } from "src/locale";
import { pageNumbers } from "src/modules/Pagination";

function PageLink({ page, current, onPage }) {
	const active = page === current;
	return (
		<li className={cn("page-item", active && "active")}>
			<button
				type="button"
				className="page-link"
				onClick={() => onPage(page)}
				aria-current={active ? "page" : undefined}
				aria-label={intl.formatMessage({ id: "pagination.page" }, { page: page + 1 })}
			>
				{page + 1}
			</button>
		</li>
	);
}

/**
 * Tabler pagination for a client-side paginated table, in a card footer with "Showing 1 to 10 of 23". Renders
 * nothing when everything fits on one page.
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
		<div className="card-footer d-flex flex-wrap align-items-center gap-2">
			<p className="m-0 text-secondary">
				<T id="pagination.showing" data={{ from, to, total }} />
			</p>
			<nav className="ms-auto" aria-label={intl.formatMessage({ id: "pagination.label" })}>
				<ul className="pagination m-0">
					<li className={cn("page-item", pageIndex === 0 && "disabled")}>
						<button
							type="button"
							className="page-link"
							onClick={() => onPage(pageIndex - 1)}
							disabled={pageIndex === 0}
							aria-label={intl.formatMessage({ id: "pagination.previous" })}
						>
							<IconChevronLeft className="icon" aria-hidden="true" />
						</button>
					</li>
					{pageNumbers(pageIndex, count).map((page, index) =>
						page === null ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity of its own
							<li key={`gap-${index}`} className="page-item disabled">
								<span className="page-link">…</span>
							</li>
						) : (
							<PageLink key={page} page={page} current={pageIndex} onPage={onPage} />
						),
					)}
					<li className={cn("page-item", pageIndex >= count - 1 && "disabled")}>
						<button
							type="button"
							className="page-link"
							onClick={() => onPage(pageIndex + 1)}
							disabled={pageIndex >= count - 1}
							aria-label={intl.formatMessage({ id: "pagination.next" })}
						>
							<IconChevronRight className="icon" aria-hidden="true" />
						</button>
					</li>
				</ul>
			</nav>
		</div>
	);
}

export { TablePagination };
