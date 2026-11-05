import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteDnsCredential } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	HasPermission,
	ImportExportButtons,
	ListPage,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { useDnsCredentials, useListFilters } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal, showDnsCredentialModal } from "src/modals";
import { DNS_CREDENTIAL_LIST_EXPAND } from "src/modules/CertificateTabs";
import { activeFilterCount } from "src/modules/ListFilters";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import { CertificateTabs } from "../Tabs";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useDnsCredentials(DNS_CREDENTIAL_LIST_EXPAND);

	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter((item) => needle === "" || item.name.toLowerCase().includes(needle));
	const isFiltered = activeFilterCount(filters, []) > 0 && Boolean(data?.length);

	const loaded = !(isPending || isError);

	return (
		<ListPage
			title={<T id="certificates-dns" />}
			section="certificates"
			help="Certificates"
			tabs={<CertificateTabs />}
			actions={
				<>
					<ImportExportButtons
						kind="dns_credentials"
						permissionSection={CERTIFICATES}
						hasItems={Boolean(data?.length)}
					/>
					<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
						{data?.length ? (
							<Button color="primary" size="sm" onClick={() => showDnsCredentialModal("new")}>
								<Plus data-icon="inline-start" aria-hidden="true" />
								<T id="dns-credentials.add" />
							</Button>
						) : null}
					</HasPermission>
				</>
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
					isFetching={isFetching}
					isFiltered={isFiltered}
					sorting={sorting}
					onSortingChange={setSorting}
					onEdit={(id) => showDnsCredentialModal(id)}
					onDelete={(id) => {
						const credential = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "dns-credential" }} />,
							onConfirm: async () => {
								await deleteDnsCredential(id);
								showObjectSuccess("dns-credential", "deleted");
							},
							invalidations: [["dns-credentials"], ["dns-credential", id], ["certificates"]],
							children: <T id="object.delete.content" tData={{ object: "dns-credential" }} />,
							subject: credential?.name,
						});
					}}
					onNew={() => showDnsCredentialModal("new")}
				/>
			)}
		</ListPage>
	);
}
