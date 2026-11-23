import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteDdnsRecord } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ListPage, ListToolbar, LoadingPage } from "src/components";
import {
	DDNS_KEYS,
	useDdnsRecords,
	useListFilters,
	usePaging,
	useSetDdnsRecord,
	useUpdateDdnsRecordNow,
} from "src/hooks";
import { intl, T } from "src/locale";
import { showDdnsHistoryModal, showDdnsRecordModal, showDeleteConfirmModal } from "src/modals";
import { DDNS_RECORD_LIST_EXPAND } from "src/modules/CertificateTabs";
import { recordStateOf } from "src/modules/DdnsForms";
import { activeFilterCount } from "src/modules/ListFilters";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showApiError, showError, showObjectSuccess, showSuccess } from "src/notifications";
import { CertificateTabs } from "../Tabs";
import { ddnsErrorText } from "./errorText";
import { StatusCard } from "./StatusCard";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useDdnsRecords(DDNS_RECORD_LIST_EXPAND);
	const [updatingId, setUpdatingId] = useState(null);
	const updateNow = useUpdateDdnsRecordNow();
	const setRecord = useSetDdnsRecord();

	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter(
		(item) =>
			needle === "" ||
			item.name.toLowerCase().includes(needle) ||
			(item.target ?? "").toLowerCase().includes(needle),
	);
	const isFiltered = activeFilterCount(filters, []) > 0 && Boolean(data?.length);
	// a search or a new sort starts on the first page
	const paging = usePaging({
		list: "ddns-records",
		total: displayed.length,
		signature: JSON.stringify([filters, sorting]),
	});

	const loaded = !(isPending || isError);

	const onUpdateNow = (id) => {
		if (updatingId !== null) return;
		setUpdatingId(id);
		updateNow.mutate(id, {
			onSuccess: (record) => {
				const state = recordStateOf(record, Date.now());
				if (state.kind === "failed") {
					showError(
						ddnsErrorText(record) ?? intl.formatMessage({ id: "ddns.toast.failed" }, { name: record.name }),
					);
					return;
				}
				showSuccess(intl.formatMessage({ id: `ddns.toast.${state.kind}` }, { name: record.name }));
			},
			// a paused updater answers 409 with error.ddns-paused, shown translated
			onError: showApiError,
			onSettled: () => setUpdatingId(null),
		});
	};

	return (
		<ListPage
			title={<T id="certificates-dns" />}
			section="certificates"
			help="Certificates"
			tabs={
				<>
					<CertificateTabs />
					<StatusCard />
				</>
			}
			actions={
				<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
					{data?.length ? (
						<Button color="primary" size="sm" onClick={() => showDdnsRecordModal()}>
							<Plus data-icon="inline-start" aria-hidden="true" />
							<T id="ddns.add" />
						</Button>
					) : null}
				</HasPermission>
			}
			toolbar={
				loaded ? (
					<ListToolbar
						filters={filters}
						setFilter={setFilter}
						clear={clear}
						total={data?.length ?? 0}
						shown={displayed.length}
						kinds={[]}
						sorting={{ columns, state: sorting, onChange: setSorting }}
					/>
				) : null
			}
		>
			{/* while the list loads or fails, the title and the tabs stay and the card holds the state */}
			{isPending ? (
				<LoadingPage noLogo delay={300} />
			) : isError ? (
				<div className="p-4">
					<ErrorAlert error={error} />
				</div>
			) : (
				<Table
					data={displayed}
					paging={paging}
					isFetching={isFetching}
					isFiltered={isFiltered}
					onClearFilters={clear}
					sorting={sorting}
					onSortingChange={setSorting}
					updatingId={updatingId}
					onEdit={(id) => showDdnsRecordModal(id)}
					onHistory={(id) => showDdnsHistoryModal(id)}
					onUpdateNow={onUpdateNow}
					onToggle={(id) => {
						const record = data?.find((item) => item.id === id);
						if (!record) return;
						setRecord.mutate(
							{ id, enabled: !record.enabled },
							{
								onSuccess: () =>
									showObjectSuccess("ddns-record", record.enabled ? "disabled" : "enabled"),
								onError: showApiError,
							},
						);
					}}
					onDelete={(id) => {
						const record = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "ddns-record" }} />,
							onConfirm: async () => {
								await deleteDdnsRecord(id);
								showObjectSuccess("ddns-record", "deleted");
							},
							invalidations: [...DDNS_KEYS, ["dns-credentials"], ["dns-credential"]],
							children: <T id="ddns.delete.content" />,
							subject: record?.name,
						});
					}}
				/>
			)}
		</ListPage>
	);
}
