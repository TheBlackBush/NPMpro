import { IconHelp, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { deleteCertificate, downloadCertificate } from "src/api/backend";
import { Button, certificateProviderTranslation, ErrorAlert, HasPermission, LoadingPage } from "src/components";
import { useCertificates } from "src/hooks";
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
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showApiError, showObjectSuccess } from "src/notifications";
import Table from "./Table";
import { Tabs } from "./Tabs";

export default function TableWrapper() {
	const [search, setSearch] = useState("");
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

	useEffect(() => {
		// this can happen if someone deletes the last item while searching
		if (search !== "" && !data?.length) {
			setSearch("");
		}
	});

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

	let filtered = null;
	if (search) {
		filtered = data?.filter(
			(item) =>
				item.domainNames.some((domain) => domain.toLowerCase().includes(search)) ||
				item.niceName.toLowerCase().includes(search),
		);
	}

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
							<div className="ms-auto d-flex flex-wrap btn-list">
								{data?.length ? (
									<div className="input-group input-group-flat w-auto">
										<span className="input-group-text input-group-text-sm">
											<IconSearch size={16} />
										</span>
										<input
											type="text"
											className="form-control form-control-sm"
											placeholder={intl.formatMessage({ id: "search" })}
											aria-label={intl.formatMessage({ id: "search" })}
											autoComplete="off"
											onChange={(e) => setSearch(e.target.value.toLowerCase().trim())}
										/>
									</div>
								) : null}
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
							</div>
						</div>
					</div>
				</div>
				<Table
					data={filtered ?? data ?? []}
					isFiltered={search}
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
