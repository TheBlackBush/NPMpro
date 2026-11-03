import { useState } from "react";
import { deleteCertificate, downloadCertificate } from "src/api/backend";
import {
	certificateProviderTranslation,
	ErrorAlert,
	ImportExportButtons,
	ListPage,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { useCertificates, useListFilters } from "src/hooks";
import { formatDateTime, T } from "src/locale";
import {
	showChangeDnsCredentialModal,
	showCustomCertificateModal,
	showDeleteConfirmModal,
	showReachabilityModal,
	showRenewCertificateModal,
} from "src/modals";
import { activeFilterCount, filterCertificates } from "src/modules/ListFilters";
import { CERTIFICATES } from "src/modules/Permissions";
import { showApiError, showObjectSuccess } from "src/notifications";
import { AddCertificateMenu } from "./AddCertificateMenu";
import Table, { useColumns } from "./Table";
import { CertificateTabs } from "./Tabs";

export default function TableWrapper() {
	const [sorting, setSorting] = useState([{ id: "expiresOn", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { isFetching, isPending, isError, error, data } = useCertificates([
		"owner",
		"dead_hosts",
		"proxy_hosts",
		"redirection_hosts",
		"streams",
		"mtls_dead_hosts",
		"mtls_proxy_hosts",
		"mtls_redirection_hosts",
		"mtls_streams",
	]);
	const { filters, setFilter, clear } = useListFilters();

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const handleDownload = async (id) => {
		try {
			await downloadCertificate(id);
		} catch (err) {
			showApiError(err);
		}
	};

	const displayed = filterCertificates(data ?? [], filters, {
		searchText: (item) => `${item.domainNames.join(" ")} ${item.niceName}`,
	});
	const isFiltered = activeFilterCount(filters, ["expiry"]) > 0 && Boolean(data?.length);

	return (
		<ListPage
			title={<T id="certificates-dns" />}
			section="certificates"
			count={data.length}
			help="Certificates"
			tabs={<CertificateTabs />}
			actions={
				<>
					<ImportExportButtons
						kind="certificates"
						permissionSection={CERTIFICATES}
						hasItems={Boolean(data?.length)}
					/>
					{data?.length ? <AddCertificateMenu size="sm" /> : null}
				</>
			}
			toolbar={
				<ListToolbar
					filters={filters}
					setFilter={setFilter}
					clear={clear}
					total={data?.length ?? 0}
					shown={displayed.length}
					kinds={["expiry"]}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
			}
		>
			<Table
				data={displayed}
				isFiltered={isFiltered}
				onClearFilters={clear}
				sorting={sorting}
				onSortingChange={setSorting}
				isFetching={isFetching}
				onRenew={showRenewCertificateModal}
				onChangeDnsCredential={showChangeDnsCredentialModal}
				onDownload={handleDownload}
				onEdit={(cert) => showCustomCertificateModal(cert)}
				onTest={(domains) => showReachabilityModal(domains)}
				onDelete={(id) => {
					const certificate = data?.find((item) => item.id === id);
					const domainNames = certificate?.domainNames.join(", ");
					showDeleteConfirmModal({
						title: <T id="object.delete" tData={{ object: "certificate" }} />,
						onConfirm: async () => {
							await deleteCertificate(id);
							showObjectSuccess("certificate", "deleted");
						},
						invalidations: [["certificates"], ["certificate", id]],
						children: <T id="object.delete.content" tData={{ object: "certificate" }} />,
						subject: domainNames || certificate?.niceName,
						details: certificate ? (
							<>
								{domainNames && certificate.niceName !== domainNames ? (
									<div>{certificate.niceName}</div>
								) : null}
								<div>
									<T id={certificateProviderTranslation(certificate.provider)} />
									{certificate.npmproDnsProvider ? ` – ${certificate.npmproDnsProvider}` : null}
								</div>
								<div>
									<T
										id="expires.on"
										data={{
											date: formatDateTime(certificate.expiresOn),
										}}
									/>
								</div>
							</>
						) : null,
					});
				}}
			/>
		</ListPage>
	);
}
