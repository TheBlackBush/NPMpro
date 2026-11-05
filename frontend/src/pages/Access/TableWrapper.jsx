import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteAccessList } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	HasPermission,
	ImportExportButtons,
	ListPage,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { useAccessLists, useListFilters } from "src/hooks";
import { T } from "src/locale";
import { showAccessListModal, showDeleteConfirmModal } from "src/modals";
import { activeFilterCount } from "src/modules/ListFilters";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useAccessLists(["owner", "items", "clients"]);

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter((item) => needle === "" || item.name.toLowerCase().includes(needle));
	const isFiltered = activeFilterCount(filters, []) > 0 && Boolean(data?.length);

	return (
		<ListPage
			title={<T id="access-lists" />}
			section="accessLists"
			count={data.length}
			help="AccessLists"
			actions={
				<>
					<ImportExportButtons
						kind="access_lists"
						permissionSection={ACCESS_LISTS}
						hasItems={Boolean(data?.length)}
					/>
					<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
						{data?.length ? (
							<Button color="primary" size="sm" onClick={() => showAccessListModal("new")}>
								<Plus data-icon="inline-start" aria-hidden="true" />
								<T id="object.add" tData={{ object: "access-list" }} />
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
					shown={displayed.length}
					kinds={[]}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
			}
		>
			<Table
				data={displayed}
				isFetching={isFetching}
				isFiltered={isFiltered}
				sorting={sorting}
				onSortingChange={setSorting}
				onEdit={(id) => showAccessListModal(id)}
				onDelete={(id) => {
					const accessList = data?.find((item) => item.id === id);
					showDeleteConfirmModal({
						title: <T id="object.delete" tData={{ object: "access-list" }} />,
						onConfirm: async () => {
							await deleteAccessList(id);
							showObjectSuccess("access-list", "deleted");
						},
						invalidations: [["access-lists"], ["access-list", id], ["proxy-hosts"], ["proxy-host"]],
						children: <T id="object.delete.content" tData={{ object: "access-list" }} />,
						subject: accessList?.name,
						details: accessList?.proxyHostCount ? (
							<T id="proxy-hosts.count" data={{ count: accessList.proxyHostCount }} />
						) : null,
					});
				}}
				onNew={() => showAccessListModal("new")}
			/>
		</ListPage>
	);
}
