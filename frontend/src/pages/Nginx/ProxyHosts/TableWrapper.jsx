import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteProxyHost, toggleProxyHost } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ImportExportButtons, ListToolbar, LoadingPage } from "src/components";
import { getDirectory, useDirectorySuggestions, useListFilters, useProxyHosts } from "src/hooks";
import { T } from "src/locale";
import { HelpButton, showDeleteConfirmModal, showProxyHostModal } from "src/modals";
import { servesCurrentPage } from "src/modules/CurrentPage";
import { forwardSummary } from "src/modules/Forward";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { sectionColor, stripeClass } from "src/modules/SectionColors";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { isFetching, isPending, isError, error, data } = useProxyHosts(["owner", "access_lists", "certificate"]);
	const groups = useDirectorySuggestions(data);
	const { filters, setFilter, clear } = useListFilters(groups);

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	// the host with this id, and whether it serves the page the browser is on (disabling or deleting it may lock the
	// user out of NPMpro)
	const hostOf = (id) => data?.find((item) => item.id === id);
	const servesThisPage = (host) => servesCurrentPage(host?.domainNames, window.location.hostname);

	// turns the host on or off and says how it went; throws when the request fails
	const toggle = async (id, enabled) => {
		const row = await toggleProxyHost(id, enabled);
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["proxy-hosts"] }),
			queryClient.invalidateQueries({ queryKey: ["proxy-host", id] }),
		]);
		const nginxErr = getNginxConfigError(row);
		if (nginxErr === null) {
			showObjectSuccess("proxy-host", enabled ? "enabled" : "disabled");
		} else {
			showNginxConfigError("proxy-host", nginxErr);
		}
	};

	const handleDisableToggle = async (id, enabled) => {
		const host = hostOf(id);
		// disabling the host that serves this page asks first; the dialog shows a failure itself
		if (!enabled && servesThisPage(host)) {
			showDeleteConfirmModal({
				title: <T id="object.disable" tData={{ object: "proxy-host" }} />,
				children: <T id="object.disable.content" tData={{ object: "proxy-host" }} />,
				subject: host.domainNames.join(", "),
				details: forwardSummary(host),
				warning: <T id="proxy-host.serves-this-page" />,
				confirmLabel: <T id="action.disable" />,
				onConfirm: () => toggle(id, false),
				invalidations: [],
			});
			return;
		}
		try {
			await toggle(id, enabled);
		} catch (err) {
			showApiError(err);
		}
	};

	const displayedHosts = filterHosts(data ?? [], filters, {
		searchText: (item) => `${item.domainNames.join(" ")} ${forwardSummary(item)} ${getDirectory(item) ?? ""}`,
		getGroup: (item) => getDirectory(item) ?? "",
	});
	const isFiltered = activeFilterCount(filters, ["status", "tls", "group"]) > 0 && Boolean(data?.length);
	const groupingActive = displayedHosts.some(getDirectory);

	const sharedTableProps = {
		isFiltered,
		onClearFilters: clear,
		isFetching,
		sorting,
		onSortingChange: setSorting,
		onEdit: (id) => showProxyHostModal(id),
		onClone: (id) => showProxyHostModal(id, true),
		onDelete: (id) => {
			const host = hostOf(id);
			showDeleteConfirmModal({
				title: <T id="object.delete" tData={{ object: "proxy-host" }} />,
				onConfirm: async () => {
					await deleteProxyHost(id);
					showObjectSuccess("proxy-host", "deleted");
				},
				invalidations: [["proxy-hosts"], ["proxy-host", id], ["certificates"], ["access-lists"]],
				children: <T id="object.delete.content" tData={{ object: "proxy-host" }} />,
				subject: host?.domainNames.join(", "),
				details: host && forwardSummary(host),
				warning: servesThisPage(host) ? <T id="proxy-host.serves-this-page" /> : null,
			});
		},
		onDisableToggle: handleDisableToggle,
		onNew: () => showProxyHostModal("new"),
	};

	return (
		<div className="card mt-4">
			<div className={stripeClass("proxyHosts")} />
			<div className="card-table">
				<div className="card-header flex-wrap gap-2">
					<h2 className="card-title fs-2 fw-semibold text-nowrap">
						<T id="proxy-hosts" />
					</h2>
					<div className="card-actions btn-list">
						<HelpButton doc="ProxyHosts" />
						<ImportExportButtons
							kind="proxy_hosts"
							permissionSection={PROXY_HOSTS}
							hasItems={Boolean(data?.length)}
						/>
						<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
							{data?.length ? (
								<Button
									size="sm"
									color={sectionColor("proxyHosts")}
									onClick={() => showProxyHostModal("new")}
								>
									<T id="object.add" tData={{ object: "proxy-host" }} />
								</Button>
							) : null}
						</HasPermission>
					</div>
				</div>
				<ListToolbar
					filters={filters}
					setFilter={setFilter}
					clear={clear}
					total={data?.length ?? 0}
					shown={displayedHosts.length}
					kinds={["status", "tls", "group"]}
					groups={groups}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
				<Table
					data={displayedHosts}
					groupBy={groupingActive ? getDirectory : undefined}
					renderGroupLabel={(key) => (key === "" ? <T id="proxy-host.no-directory" /> : key)}
					{...sharedTableProps}
				/>
			</div>
		</div>
	);
}
