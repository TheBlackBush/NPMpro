import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { AppSelect } from "src/components/AppSelect";
import { TapTooltip } from "src/components/TapTooltip";
import { Button } from "src/components/ui/button";
import { Label } from "src/components/ui/label";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { pageCount, pageNumbers, pageRange, showPager } from "src/modules/Pagination";
import { PAGE_SIZES } from "src/modules/Preferences";

const SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));

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
 * One paging bar of a list (the shadcn data-table layout): "Showing 1 to 25 of 60" on the left, the rows per page
 * choice and the page buttons as one group on the right; on a phone the count and the rows per page choice share the
 * first line and the page buttons take the second. Renders nothing for 10 rows or fewer; the page buttons show from
 * two pages.
 *
 * @param {Object}   props
 * @param {number}   props.pageIndex  zero-based current page
 * @param {number}   props.pageSize
 * @param {number}   props.total      rows in all pages
 * @param {Function} props.onPage     (pageIndex) => void
 * @param {Function} [props.onSize]   (pageSize) => void; without it the rows per page choice is not shown
 * @param {"top"|"bottom"} [props.placement]  which edge of the table the bar sits on (its border)
 */
function TablePagination({ pageIndex, pageSize, total, onPage, onSize, placement = "bottom" }) {
	const selectId = useId();
	const nav = useRef(null);
	const pressed = useRef(false);
	// a previous or next button that reaches the first or last page turns disabled: after that render focus moves to
	// the current page button (runs after every render, acts only after such a press)
	useEffect(() => {
		if (!pressed.current) return;
		pressed.current = false;
		const active = document.activeElement;
		if (!active || active === document.body || active.disabled) {
			nav.current?.querySelector('[aria-current="page"]')?.focus();
		}
	});
	if (!showPager(total)) return null;
	const count = pageCount(total, pageSize);
	const { from, to } = pageRange(pageIndex, pageSize, total);
	const step = (target) => {
		pressed.current = true;
		onPage(target);
	};
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-3 sm:gap-x-4 sm:px-4",
				placement === "top" ? "border-b" : "border-t",
			)}
			data-slot="table-pagination"
		>
			<p className="m-0 text-sm text-muted-foreground">
				<T id="pagination.showing" data={{ from, to, total }} />
			</p>
			{onSize ? (
				<div className="ml-auto flex items-center gap-2">
					<Label htmlFor={selectId} className="text-sm font-normal text-muted-foreground">
						<T id="pagination.rows-per-page" />
					</Label>
					<AppSelect
						id={selectId}
						size="sm"
						className="w-20"
						value={String(pageSize)}
						onValueChange={(value) => onSize(Number(value))}
						options={SIZE_OPTIONS}
					/>
				</div>
			) : null}
			{count > 1 ? (
				<nav
					ref={nav}
					className="flex w-full justify-end md:w-auto"
					aria-label={intl.formatMessage({ id: "pagination.label" })}
				>
					<ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
						<li>
							<TapTooltip content={intl.formatMessage({ id: "pagination.previous" })} tap={false}>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => step(pageIndex - 1)}
									disabled={pageIndex === 0}
									aria-label={intl.formatMessage({ id: "pagination.previous" })}
								>
									<ChevronLeft aria-hidden="true" />
								</Button>
							</TapTooltip>
						</li>
						{pageNumbers(pageIndex, count).map((page, index) =>
							page === null ? (
								<li key={`gap-${index}`} className="px-2 text-muted-foreground" aria-hidden="true">
									…
								</li>
							) : (
								<PageLink key={page} page={page} current={pageIndex} onPage={step} />
							),
						)}
						<li>
							<TapTooltip content={intl.formatMessage({ id: "pagination.next" })} tap={false}>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => step(pageIndex + 1)}
									disabled={pageIndex >= count - 1}
									aria-label={intl.formatMessage({ id: "pagination.next" })}
								>
									<ChevronRight aria-hidden="true" />
								</Button>
							</TapTooltip>
						</li>
					</ul>
				</nav>
			) : null}
		</div>
	);
}

/**
 * A table with a paging bar above and below it
 *
 * @param {Object} props
 * @param {{pageIndex: number, pageSize: number, setPageIndex: Function, setPageSize: Function}} props.paging  from usePaging
 * @param {number} props.total  rows in all pages
 */
function PagedTable({ paging, total, children }) {
	const bar = (placement) => (
		<TablePagination
			pageIndex={paging.pageIndex}
			pageSize={paging.pageSize}
			total={total}
			onPage={paging.setPageIndex}
			onSize={paging.setPageSize}
			placement={placement}
		/>
	);
	return (
		<>
			{bar("top")}
			{children}
			{bar("bottom")}
		</>
	);
}

export { PagedTable, TablePagination };
