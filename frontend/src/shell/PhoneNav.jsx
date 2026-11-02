import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { intl } from "src/locale";
import { groupAlert, pageBadge, pageSections } from "src/modules/Navigation";
import { Button } from "src/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "src/ui/sheet";
import { NavIcon } from "./NavIcon";

const text = (id, values) => intl.formatMessage({ id }, values);

const TAB =
	"tw:relative tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-0.5 tw:px-1 tw:pt-2 tw:pb-1.5 tw:text-[0.6875rem] tw:font-medium tw:text-muted-foreground tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:focus-visible:ring-inset tw:aria-[current=true]:text-foreground";

/** A tab's marks: the brand bar over the current tab, a dot when a page of the group needs attention */
function TabMarks({ current, alert }) {
	return (
		<>
			{current && (
				<span
					aria-hidden="true"
					className="tw:absolute tw:inset-x-3 tw:top-0 tw:h-[3px] tw:rounded-b-full tw:bg-(image:--brand-gradient)"
				/>
			)}
			{alert && (
				<span
					aria-hidden="true"
					className={cn(
						"tw:absolute tw:top-1.5 tw:left-[calc(50%+0.4rem)] tw:size-2 tw:rounded-full",
						alert === "error" ? "tw:bg-destructive" : "tw:bg-warning",
					)}
				/>
			)}
		</>
	);
}

/** One page of the sheet: icon, title, count */
function SheetPage({ page, active, report, onClose }) {
	const badge = pageBadge(page, report);
	const tone = badge?.errors > 0 ? "error" : badge?.expiring > 0 ? "warning" : null;
	const content = (
		<>
			<NavIcon name={page.icon} className="tw:size-5 tw:shrink-0 tw:text-muted-foreground" />
			<span className="tw:min-w-0 tw:flex-1 tw:truncate">{text(page.titleKey)}</span>
			{badge && (
				<span
					className={cn(
						"tw:rounded-md tw:px-1.5 tw:text-xs tw:font-medium tw:tabular-nums tw:text-muted-foreground",
						tone === "error" && "tw:bg-destructive/10 tw:text-destructive",
						tone === "warning" && "tw:bg-warning/15 tw:text-warning-foreground",
					)}
				>
					{badge.count}
				</span>
			)}
			{badge?.errors > 0 && (
				<span className="tw:sr-only">{text("nav.badge.errors", { count: badge.errors })}</span>
			)}
			{badge?.expiring > 0 && (
				<span className="tw:sr-only">{text("nav.badge.expiring", { count: badge.expiring })}</span>
			)}
		</>
	);
	const className = cn(
		"tw:flex tw:min-h-11 tw:items-center tw:gap-3 tw:rounded-lg tw:px-3 tw:text-sm tw:text-foreground tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:active:bg-accent",
		active && "tw:bg-accent tw:font-medium",
	);
	if (page.href) {
		return (
			<a href={page.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClose}>
				{content}
			</a>
		);
	}
	return (
		<Link to={page.to} aria-current={active ? "page" : undefined} className={className} onClick={onClose}>
			{content}
		</Link>
	);
}

/**
 * The phone navigation (below 768 px): a bottom tab bar with the five groups. A tab opens its group's first page;
 * tapping the current tab opens its pages as a bottom sheet (shadcn's Sheet).
 *
 * @param {Object} props
 * @param {Object[]} props.groups
 * @param {Object|null} props.current
 * @param {Object} [props.report]
 */
export function PhoneNav({ groups, current, report }) {
	const [open, setOpen] = useState(false);
	const group = current?.group;
	return (
		<>
			<nav
				aria-label={text("aria.main-navigation")}
				className="tw:fixed tw:inset-x-0 tw:bottom-0 tw:z-30 tw:flex tw:border-t tw:bg-sidebar tw:pb-[env(safe-area-inset-bottom)] tw:text-sidebar-foreground tw:md:hidden"
			>
				{groups.map((item) => {
					const isCurrent = group?.id === item.id;
					const label = text(item.titleKey);
					const marks = <TabMarks current={isCurrent} alert={groupAlert(item, report)} />;
					if (isCurrent && item.panel) {
						return (
							<button
								key={item.id}
								type="button"
								className={TAB}
								aria-current="true"
								aria-haspopup="dialog"
								aria-expanded={open}
								onClick={() => setOpen(true)}
							>
								<NavIcon name={item.icon} className="tw:size-5" />
								<span className="tw:max-w-full tw:truncate">{label}</span>
								{marks}
							</button>
						);
					}
					const first = item.pages.find((page) => page.to);
					return (
						<Link key={item.id} to={first.to} className={TAB} aria-current={isCurrent ? "true" : undefined}>
							<NavIcon name={item.icon} className="tw:size-5" />
							<span className="tw:max-w-full tw:truncate">{label}</span>
							{marks}
						</Link>
					);
				})}
			</nav>
			{group?.panel && (
				<Sheet open={open} onOpenChange={setOpen}>
					<SheetContent
						side="bottom"
						showCloseButton={false}
						className="tw:max-h-[80svh] tw:gap-0 tw:rounded-t-xl"
					>
						<SheetHeader className="tw:flex-row tw:items-center tw:justify-between tw:pb-1">
							<SheetTitle>{text(group.titleKey)}</SheetTitle>
							<SheetDescription className="tw:sr-only">{text("nav.sheet-description")}</SheetDescription>
							<SheetClose asChild>
								<Button variant="ghost" size="icon-sm" aria-label={text("action.close")}>
									<XIcon aria-hidden="true" />
								</Button>
							</SheetClose>
						</SheetHeader>
						<div className="tw:overflow-y-auto tw:px-2 tw:pb-[calc(1rem+env(safe-area-inset-bottom))]">
							{pageSections(group).map((section) => (
								<section key={section.id} className="tw:py-1">
									{section.titleKey && (
										<h3 className="tw:px-3 tw:pt-2 tw:pb-1 tw:text-xs tw:font-medium tw:text-muted-foreground">
											{text(section.titleKey)}
										</h3>
									)}
									{section.pages.map((page) => (
										<SheetPage
											key={page.id}
											page={page}
											active={current?.page.id === page.id}
											report={report}
											onClose={() => setOpen(false)}
										/>
									))}
								</section>
							))}
						</div>
					</SheetContent>
				</Sheet>
			)}
		</>
	);
}
