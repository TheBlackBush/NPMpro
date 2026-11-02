import { useQueries } from "@tanstack/react-query";
import { CircleAlert, ExternalLink, LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router";
import {
	getAccessLists,
	getCertificates,
	getDeadHosts,
	getProxyHosts,
	getRedirectionHosts,
	getStreams,
	getUsers,
} from "src/api/backend";
import { intl } from "src/locale";
import {
	showAccessListModal,
	showDeadHostModal,
	showProxyHostModal,
	showRedirectionHostModal,
	showStreamModal,
	showUserModal,
} from "src/modals";
import { itemsOf, pageItems, paletteFilter, paletteTypes } from "src/modules/CommandPalette";
import { SETTINGS_CATEGORIES } from "src/modules/SettingsSections";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "src/ui/command";
import { NavIcon } from "./NavIcon";

const text = (id, values) => intl.formatMessage({ id }, values);

// the list functions and windows that modules/CommandPalette.js names
const FETCH = {
	getAccessLists,
	getCertificates,
	getDeadHosts,
	getProxyHosts,
	getRedirectionHosts,
	getStreams,
	getUsers,
};
const OPEN = {
	showAccessListModal,
	showDeadHostModal,
	showProxyHostModal,
	showRedirectionHostModal,
	showStreamModal,
	showUserModal,
};

// the lists stay fresh for a minute, as the list pages' own queries (hooks/useProxyHosts.js and the others)
const STALE = 60 * 1000;

/** An item's two lines: what it is called and, muted, where it leads */
function ItemText({ label, detail }) {
	return (
		<span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-baseline tw:gap-2">
			<span className="tw:truncate">{label}</span>
			{detail && <span className="tw:truncate tw:text-xs tw:text-muted-foreground">{detail}</span>}
		</span>
	);
}

/** A row that cannot be chosen: a type's items loading, or its request failed */
function StatusRow({ value, icon: Icon, spin, children }) {
	return (
		<CommandItem value={value} disabled forceMount className="tw:text-muted-foreground">
			<Icon className={spin ? "tw:motion-safe:animate-spin" : undefined} aria-hidden="true" />
			{children}
		</CommandItem>
	);
}

/**
 * The palette's content, mounted while it is open: the pages at once, every item type the user may see from its list
 * endpoint (one request each, on the first opening; cached, refreshed in the background when reopened)
 */
function PaletteContent({ groups, onDone }) {
	const navigate = useNavigate();
	const types = paletteTypes(groups);
	const lists = useQueries({
		queries: types.map((type) => ({
			queryKey: [type.queryKey, { expand: undefined }],
			queryFn: () => FETCH[type.fetch](),
			staleTime: STALE,
			retry: 1,
		})),
	});
	const pages = pageItems(groups);

	// close first, then go: the window opens over the page, not under the closing palette
	const choose = (action) => {
		onDone();
		setTimeout(action, 0);
	};
	const openPage = (page) =>
		choose(() => (page.href ? window.open(page.href, "_blank", "noopener,noreferrer") : navigate(page.to)));
	const openItem = (type, item) =>
		choose(() =>
			type.open.route ? navigate(type.open.route(item.row)) : OPEN[type.open.modal](item.id, type.open.section),
		);

	return (
		<Command filter={paletteFilter} loop>
			<CommandInput placeholder={text("palette.placeholder")} aria-label={text("search")} />
			<CommandList className="tw:max-h-[min(24rem,60svh)]">
				<CommandEmpty>{text("empty-search")}</CommandEmpty>
				<CommandGroup heading={text("palette.pages")}>
					{pages.map(({ value, page, group }) => {
						const title = text(page.titleKey);
						const category = SETTINGS_CATEGORIES.find(({ id }) => id === page.category);
						const where = category
							? `${text(group.titleKey)} / ${text(category.labelKey)}`
							: text(group.titleKey);
						return (
							<CommandItem
								key={value}
								value={value}
								keywords={[title, where]}
								onSelect={() => openPage(page)}
							>
								<NavIcon name={page.icon} />
								<ItemText label={title} detail={group.pages.length > 1 ? where : ""} />
								{page.href && (
									<ExternalLink className="tw:size-3.5! tw:opacity-60" aria-hidden="true" />
								)}
							</CommandItem>
						);
					})}
				</CommandGroup>
				{types.map((type, index) => {
					const { data, isPending, isError } = lists[index];
					const heading = text(type.titleKey);
					return (
						<CommandGroup key={type.id} heading={heading}>
							{isPending && (
								<StatusRow value={`${type.id}:loading`} icon={LoaderCircle} spin>
									{text("loading")}
								</StatusRow>
							)}
							{isError && !data && (
								<StatusRow value={`${type.id}:error`} icon={CircleAlert}>
									{text("palette.error")}
								</StatusRow>
							)}
							{itemsOf(type, data).map((item) => (
								<CommandItem
									key={item.value}
									value={item.value}
									keywords={[...item.keywords, heading]}
									onSelect={() => openItem(type, item)}
								>
									<NavIcon name={type.icon} />
									<ItemText label={item.label} detail={item.detail} />
								</CommandItem>
							))}
						</CommandGroup>
					);
				})}
			</CommandList>
		</Command>
	);
}

/**
 * The command palette (Ctrl+K or the header's search): pages, Settings sections, hosts, streams, certificates, access
 * lists and users. Choosing a page goes there; choosing an item opens its window (a certificate: its list, filtered).
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onOpenChange
 * @param {Object[]} props.groups  the visible groups (modules/Navigation.js visibleGroups)
 */
export function CommandPalette({ open, onOpenChange, groups }) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={text("search")}
			description={text("palette.description")}
			className="tw:top-4 tw:sm:top-1/3 tw:sm:max-w-lg"
		>
			<PaletteContent groups={groups} onDone={() => onOpenChange(false)} />
		</CommandDialog>
	);
}
