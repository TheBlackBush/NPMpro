import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteDnsDomain } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, ListPage, ListToolbar, LoadingPage } from "src/components";
import { DOMAIN_KEYS, useDnsDomains, useListFilters, usePaging } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal, showDnsDomainModal, showDnsDomainsModal } from "src/modals";
import { DNS_DOMAIN_LIST_EXPAND } from "src/modules/CertificateTabs";
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
	const { isFetching, isPending, isError, error, data } = useDnsDomains(DNS_DOMAIN_LIST_EXPAND);

	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter((item) => needle === "" || item.name.toLowerCase().includes(needle));
	const isFiltered = activeFilterCount(filters, []) > 0 && Boolean(data?.length);
	// a search or a new sort starts on the first page
	const paging = usePaging({
		list: "dns-domains",
		total: displayed.length,
		signature: JSON.stringify([filters, sorting]),
	});

	const loaded = !(isPending || isError);

	return (
		<ListPage
			title={<T id="certificates-dns" />}
			section="certificates"
			help="Certificates"
			tabs={<CertificateTabs />}
			actions={
				<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
					{data?.length ? (
						<Button color="primary" size="sm" onClick={() => showDnsDomainsModal()}>
							<Plus data-icon="inline-start" aria-hidden="true" />
							<T id="dns-domains.add" />
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
					onEdit={(id) => showDnsDomainModal(id)}
					onDelete={(id) => {
						const domain = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "dns-domain" }} />,
							onConfirm: async () => {
								await deleteDnsDomain(id);
								showObjectSuccess("dns-domain", "deleted");
							},
							invalidations: DOMAIN_KEYS,
							children: <T id="dns-domains.delete.content" />,
							subject: domain?.name,
						});
					}}
				/>
			)}
		</ListPage>
	);
}
