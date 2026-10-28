import { IconHelp } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteDeadHost, toggleDeadHost } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ImportExportButtons, ListToolbar, LoadingPage } from "src/components";
import { getDirectory, useDeadHosts, useDirectorySuggestions, useListFilters } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeadHostModal, showDeleteConfirmModal, showHelpModal } from "src/modals";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { DEAD_HOSTS, MANAGE } from "src/modules/Permissions";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { isFetching, isPending, isError, error, data } = useDeadHosts(["owner", "certificate"]);
	const groups = useDirectorySuggestions(data);
	const { filters, setFilter, clear } = useListFilters(groups);

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const handleDisableToggle = async (id, enabled) => {
		try {
			const row = await toggleDeadHost(id, enabled);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["dead-hosts"] }),
				queryClient.invalidateQueries({ queryKey: ["dead-host", id] }),
			]);
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("dead-host", enabled ? "enabled" : "disabled");
			} else {
				showNginxConfigError("dead-host", nginxErr);
			}
		} catch (err) {
			showApiError(err);
		}
	};

	const displayedHosts = filterHosts(data ?? [], filters, {
		searchText: (item) => `${item.domainNames.join(" ")} ${getDirectory(item) ?? ""}`,
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
		onEdit: (id) => showDeadHostModal(id),
		onDelete: (id) => {
			const host = data?.find((item) => item.id === id);
			showDeleteConfirmModal({
				title: <T id="object.delete" tData={{ object: "dead-host" }} />,
				onConfirm: async () => {
					await deleteDeadHost(id);
					showObjectSuccess("dead-host", "deleted");
				},
				invalidations: [["dead-hosts"], ["dead-host", id], ["certificates"]],
				children: <T id="object.delete.content" tData={{ object: "dead-host" }} />,
				subject: host?.domainNames.join(", "),
			});
		},
		onDisableToggle: handleDisableToggle,
		onNew: () => showDeadHostModal("new"),
	};

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-red" />
			<div className="card-table">
				<div className="card-header">
					<h2 className="card-title">
						<T id="dead-hosts" />
					</h2>
					<div className="card-actions btn-list">
						<Button
							size="sm"
							className="btn-icon"
							aria-label={intl.formatMessage({ id: "help" })}
							title={intl.formatMessage({ id: "help" })}
							onClick={() => showHelpModal("DeadHosts")}
						>
							<IconHelp className="icon" aria-hidden="true" />
						</Button>
						<ImportExportButtons
							kind="dead_hosts"
							permissionSection={DEAD_HOSTS}
							hasItems={Boolean(data?.length)}
						/>
						<HasPermission section={DEAD_HOSTS} permission={MANAGE} hideError>
							{data?.length ? (
								<Button size="sm" color="red" onClick={() => showDeadHostModal("new")}>
									<T id="object.add" tData={{ object: "dead-host" }} />
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
					renderGroupLabel={(key) => (key === "" ? <T id="dead-host.no-directory" /> : key)}
					{...sharedTableProps}
				/>
			</div>
		</div>
	);
}
