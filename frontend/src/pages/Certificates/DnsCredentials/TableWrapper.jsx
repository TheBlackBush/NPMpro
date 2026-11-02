import { useState } from "react";
import { deleteDnsCredential } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	HasPermission,
	ImportExportButtons,
	ListToolbar,
	LoadingPage,
	PageHeader,
} from "src/components";
import { useDnsCredentials, useListFilters } from "src/hooks";
import { T } from "src/locale";
import { HelpButton, showDeleteConfirmModal, showDnsCredentialModal } from "src/modals";
import { activeFilterCount } from "src/modules/ListFilters";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionColor, stripeClass } from "src/modules/SectionColors";
import { showObjectSuccess } from "src/notifications";
import { Tabs } from "../Tabs";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useDnsCredentials(["owner", "certificates"]);

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
		<>
			<PageHeader
				title={<T id="dns-credentials" />}
				actions={
					<>
						<HelpButton doc="Certificates" />
						<ImportExportButtons
							kind="dns_credentials"
							permissionSection={CERTIFICATES}
							hasItems={Boolean(data?.length)}
						/>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							{data?.length ? (
								<Button
									size="sm"
									color={sectionColor("dnsCredentials")}
									onClick={() => showDnsCredentialModal("new")}
								>
									<T id="dns-credentials.add" />
								</Button>
							) : null}
						</HasPermission>
					</>
				}
			/>
			<div className="card mt-4">
				<div className={stripeClass("dnsCredentials")} />
				<Tabs />
				<div className="card-table">
					<ListToolbar
						filters={filters}
						setFilter={setFilter}
						clear={clear}
						total={data?.length ?? 0}
						shown={displayed.length}
						kinds={[]}
						sorting={{ columns, state: sorting, onChange: setSorting }}
					/>
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
				</div>
			</div>
		</>
	);
}
