import { CircleAlert, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
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
import { useAccessListGeoip, useAccessLists, useListFilters, usePaging } from "src/hooks";
import { T } from "src/locale";
import { showAccessListModal, showDeleteConfirmModal } from "src/modals";
import { activeFilterCount } from "src/modules/ListFilters";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import { StatusAlert } from "src/pages/Settings/StatusAlert";
import Table, { useColumns } from "./Table";

// country rules that let every visitor pass: no database, or nginx refused the database line
function GeoipBanner({ geoip }) {
	if (!geoip || !(geoip.listsWithRules > 0) || !(!geoip.available || geoip.failsOpen)) return null;
	return (
		<StatusAlert variant="warning" icon={CircleAlert} className="mb-3">
			<T
				id={geoip.available ? "access-list.countries.banner.fails-open" : "access-list.countries.banner"}
				data={{ count: geoip.listsWithRules }}
			/>{" "}
			<Link to="/settings/geoip" className="underline underline-offset-4">
				<T id="access-list.countries.settings-link" />
			</Link>
		</StatusAlert>
	);
}

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useAccessLists([
		"owner",
		"items",
		"clients",
		"npmpro_countries",
	]);
	const { data: geoip } = useAccessListGeoip();
	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter((item) => needle === "" || item.name.toLowerCase().includes(needle));
	// a search or a new sort starts on the first page
	const paging = usePaging({
		list: "access-lists",
		total: displayed.length,
		signature: JSON.stringify([filters, sorting]),
	});

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

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
			<GeoipBanner geoip={geoip} />
			<Table
				data={displayed}
				paging={paging}
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
