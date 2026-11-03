import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteStream, toggleStream } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	HasPermission,
	ImportExportButtons,
	ListPage,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { getDirectory, useDirectorySuggestions, useListFilters, useStreams } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal, showStreamModal } from "src/modals";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { isFetching, isPending, isError, error, data } = useStreams(["owner", "certificate"]);
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
			`${item.incomingPort} ${item.forwardingHost}:${item.forwardingPort} ${item.npmproDescription ?? ""} ${getDirectory(item) ?? ""}`,
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
		onClone: (id) => showStreamModal(id, true),
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
				details: stream?.npmproDescription,
			});
		},
		onDisableToggle: handleDisableToggle,
		onNew: () => showStreamModal("new"),
	};

	return (
		<ListPage
			title={<T id="streams" />}
			section="streams"
			count={data.length}
			help="Streams"
			actions={
				<>
					<ImportExportButtons kind="streams" permissionSection={STREAMS} hasItems={Boolean(data?.length)} />
					<HasPermission section={STREAMS} permission={MANAGE} hideError>
						{data?.length ? (
							<Button color="primary" size="sm" onClick={() => showStreamModal("new")}>
								<Plus data-icon="inline-start" aria-hidden="true" />
								<T id="object.add" tData={{ object: "stream" }} />
							</Button>
						) : null}
					</HasPermission>
				</>
			}
			toolbar={
				<ListToolbar
					filters={filters}
					setFilter={setFilter}
					clear={clear}
					total={data?.length ?? 0}
					shown={displayedStreams.length}
					kinds={["status", "tls", "group"]}
					groups={groups}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
			}
		>
			<Table
				data={displayedStreams}
				groupBy={groupingActive ? getDirectory : undefined}
				renderGroupLabel={(key) => (key === "" ? <T id="stream.no-directory" /> : key)}
				{...sharedTableProps}
			/>
		</ListPage>
	);
}
