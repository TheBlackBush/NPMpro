import { IconHelp } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteRedirectionHost, toggleRedirectionHost } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ListToolbar, LoadingPage } from "src/components";
import { getDirectory, useDirectorySuggestions, useListFilters, useRedirectionHosts } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal, showHelpModal, showRedirectionHostModal } from "src/modals";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { MANAGE, REDIRECTION_HOSTS } from "src/modules/Permissions";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";
import Table from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	const { isFetching, isPending, isError, error, data } = useRedirectionHosts(["owner", "certificate"]);
	const groups = useDirectorySuggestions(data);
	const { filters, setFilter, clear } = useListFilters(groups);

	if (isPending) {
		return <LoadingPage />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const handleDisableToggle = async (id, enabled) => {
		try {
			const row = await toggleRedirectionHost(id, enabled);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["redirection-hosts"] }),
				queryClient.invalidateQueries({ queryKey: ["redirection-host", id] }),
			]);
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("redirection-host", enabled ? "enabled" : "disabled");
			} else {
				showNginxConfigError("redirection-host", nginxErr);
			}
		} catch (err) {
			showApiError(err);
		}
	};

	const displayedHosts = filterHosts(data ?? [], filters, {
		searchText: (item) => `${item.domainNames.join(" ")} ${item.forwardDomainName} ${getDirectory(item) ?? ""}`,
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
		onEdit: (id) => showRedirectionHostModal(id),
		onDelete: (id) => {
			const host = data?.find((item) => item.id === id);
			showDeleteConfirmModal({
				title: <T id="object.delete" tData={{ object: "redirection-host" }} />,
				onConfirm: async () => {
					await deleteRedirectionHost(id);
					showObjectSuccess("redirection-host", "deleted");
				},
				invalidations: [["redirection-hosts"], ["redirection-host", id], ["certificates"]],
				children: <T id="object.delete.content" tData={{ object: "redirection-host" }} />,
				subject: host?.domainNames.join(", "),
				details:
					host &&
					(host.forwardScheme === "$scheme"
						? host.forwardDomainName
						: `${host.forwardScheme}://${host.forwardDomainName}`),
			});
		},
		onDisableToggle: handleDisableToggle,
		onNew: () => showRedirectionHostModal("new"),
	};

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-yellow" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="redirection-hosts" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<ListToolbar
								filters={filters}
								setFilter={setFilter}
								clear={clear}
								total={data?.length ?? 0}
								shown={displayedHosts.length}
								kinds={["status", "tls", "group"]}
								groups={groups}
							>
								<Button
									size="sm"
									aria-label={intl.formatMessage({ id: "help" })}
									title={intl.formatMessage({ id: "help" })}
									onClick={() => showHelpModal("RedirectionHosts")}
								>
									<IconHelp size={20} />
								</Button>
								<HasPermission section={REDIRECTION_HOSTS} permission={MANAGE} hideError>
									{data?.length ? (
										<Button
											size="sm"
											className="btn-yellow"
											onClick={() => showRedirectionHostModal("new")}
										>
											<T id="object.add" tData={{ object: "redirection-host" }} />
										</Button>
									) : null}
								</HasPermission>
							</ListToolbar>
						</div>
					</div>
				</div>
				<Table
					data={displayedHosts}
					groupBy={groupingActive ? getDirectory : undefined}
					renderGroupLabel={(key) => (key === "" ? <T id="redirection-host.no-directory" /> : key)}
					{...sharedTableProps}
				/>
			</div>
		</div>
	);
}
