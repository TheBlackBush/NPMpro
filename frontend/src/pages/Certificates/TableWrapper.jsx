import { IconHelp } from "@tabler/icons-react";
import { deleteCertificate, downloadCertificate } from "src/api/backend";
import {
	Button,
	certificateProviderTranslation,
	ErrorAlert,
	HasPermission,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { useCertificates, useListFilters } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import {
	showChangeDnsCredentialModal,
	showCustomCertificateModal,
	showDeleteConfirmModal,
	showDNSCertificateModal,
	showHelpModal,
	showHTTPCertificateModal,
	showReachabilityModal,
	showRenewCertificateModal,
} from "src/modals";
import { activeFilterCount, filterCertificates } from "src/modules/ListFilters";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showApiError, showObjectSuccess } from "src/notifications";
import Table from "./Table";
import { Tabs } from "./Tabs";

export default function TableWrapper() {
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
		return <LoadingPage />;
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
		<div className="card mt-4">
			<div className="card-status-top bg-pink" />
			<Tabs />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="certificates" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<ListToolbar
								filters={filters}
								setFilter={setFilter}
								clear={clear}
								total={data?.length ?? 0}
								shown={displayed.length}
								kinds={["expiry"]}
							>
								<Button
									size="sm"
									aria-label={intl.formatMessage({ id: "help" })}
									title={intl.formatMessage({ id: "help" })}
									onClick={() => showHelpModal("Certificates")}
								>
									<IconHelp size={20} />
								</Button>
								<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
									{data?.length ? (
										<div className="dropdown">
											<button
												type="button"
												className="btn btn-sm dropdown-toggle btn-pink mt-1"
												data-bs-toggle="dropdown"
											>
												<T id="object.add" tData={{ object: "certificate" }} />
											</button>
											<div className="dropdown-menu">
												<button
													type="button"
													className="dropdown-item"
													onClick={() => {
														showHTTPCertificateModal();
													}}
												>
													<T id="lets-encrypt-via-http" />
												</button>
												<button
													type="button"
													className="dropdown-item"
													onClick={() => {
														showDNSCertificateModal();
													}}
												>
													<T id="lets-encrypt-via-dns" />
												</button>
												<div className="dropdown-divider" />
												<button
													type="button"
													className="dropdown-item"
													onClick={() => {
														showCustomCertificateModal();
													}}
												>
													<T id="certificates.custom" />
												</button>
												<div className="dropdown-divider" />
												<button
													type="button"
													className="dropdown-item"
													onClick={() => {
														showCustomCertificateModal(undefined, "mtls");
													}}
												>
													mTLS
												</button>
											</div>
										</div>
									) : null}
								</HasPermission>
							</ListToolbar>
						</div>
					</div>
				</div>
				<Table
					data={displayed}
					isFiltered={isFiltered}
					onClearFilters={clear}
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
										{certificate.npmplusDnsProvider ? ` – ${certificate.npmplusDnsProvider}` : null}
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
			</div>
		</div>
	);
}
