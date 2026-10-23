import { IconHelp } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteStream, toggleStream } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ListToolbar, LoadingPage } from "src/components";
import { getDirectory, useDirectorySuggestions, useListFilters, useStreams } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal, showHelpModal, showStreamModal } from "src/modals";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";
import Table from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	const { isFetching, isPending, isError, error, data } = useStreams(["owner", "certificate"]);
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
			const row = await toggleStream(id, enabled);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["streams"] }),
				queryClient.invalidateQueries({ queryKey: ["stream", id] }),
			]);
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("stream", enabled ? "enabled" : "disabled");
			} else {
				showNginxConfigError("stream", nginxErr);
			}
		} catch (err) {
			showApiError(err);
		}
	};

	const displayedStreams = filterHosts(data ?? [], filters, {
		searchText: (item) =>
			`${item.incomingPort} ${item.forwardingHost}:${item.forwardingPort} ${item.npmplusDescription ?? ""} ${getDirectory(item) ?? ""}`,
		getGroup: (item) => getDirectory(item) ?? "",
	});
	const isFiltered = activeFilterCount(filters, ["status", "tls", "group"]) > 0 && Boolean(data?.length);
	const groupingActive = displayedStreams.some(getDirectory);

	const sharedTableProps = {
		isFiltered,
		onClearFilters: clear,
		isFetching,
		sorting,
		onSortingChange: setSorting,
		onEdit: (id) => showStreamModal(id),
		onDelete: (id) => {
			const stream = data?.find((item) => item.id === id);
			showDeleteConfirmModal({
				title: <T id="object.delete" tData={{ object: "stream" }} />,
				onConfirm: async () => {
					await deleteStream(id);
					showObjectSuccess("stream", "deleted");
				},
				invalidations: [["streams"], ["stream", id], ["certificates"]],
				children: <T id="object.delete.content" tData={{ object: "stream" }} />,
				subject: stream
					? `${stream.incomingPort} → ${stream.forwardingHost}${stream.forwardingPort ? `:${stream.forwardingPort}` : ""}`
					: null,
				details: stream?.npmplusDescription,
			});
		},
		onDisableToggle: handleDisableToggle,
		onNew: () => showStreamModal("new"),
	};

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-blue" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="streams" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<ListToolbar
								filters={filters}
								setFilter={setFilter}
								clear={clear}
								total={data?.length ?? 0}
								shown={displayedStreams.length}
								kinds={["status", "tls", "group"]}
								groups={groups}
							>
								<Button
									size="sm"
									aria-label={intl.formatMessage({ id: "help" })}
									title={intl.formatMessage({ id: "help" })}
									onClick={() => showHelpModal("Streams")}
								>
									<IconHelp size={20} />
								</Button>
								<HasPermission section={STREAMS} permission={MANAGE} hideError>
									{data?.length ? (
										<Button size="sm" className="btn-blue" onClick={() => showStreamModal("new")}>
											<T id="object.add" tData={{ object: "stream" }} />
										</Button>
									) : null}
								</HasPermission>
							</ListToolbar>
						</div>
					</div>
				</div>
				<Table
					data={displayedStreams}
					groupBy={groupingActive ? getDirectory : undefined}
					renderGroupLabel={(key) => (key === "" ? <T id="stream.no-directory" /> : key)}
					{...sharedTableProps}
				/>
			</div>
		</div>
	);
}
