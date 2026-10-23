import { IconHelp, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { deleteDnsCredential } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, LoadingPage } from "src/components";
import { useDnsCredentials } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal, showDnsCredentialModal, showHelpModal } from "src/modals";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import { Tabs } from "../Tabs";
import Table from "./Table";

export default function TableWrapper() {
	const [search, setSearch] = useState("");
	const { isFetching, isPending, isError, error, data } = useDnsCredentials(["owner", "certificates"]);

	useEffect(() => {
		// this can happen if someone deletes the last item while searching
		if (search !== "" && !data?.length) {
			setSearch("");
		}
	});

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	let filtered = null;
	if (search) {
		filtered = data?.filter((item) => item.name.toLowerCase().includes(search));
	}

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-pink" />
			<Tabs />
			<div className="card-table">
				<div className="card-header">
					<h2 className="card-title">
						<T id="dns-credentials" />
					</h2>
					<div className="card-actions btn-list">
						<Button
							size="sm"
							className="btn-icon"
							aria-label={intl.formatMessage({ id: "help" })}
							title={intl.formatMessage({ id: "help" })}
							onClick={() => showHelpModal("Certificates")}
						>
							<IconHelp className="icon" aria-hidden="true" />
						</Button>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							{data?.length ? (
								<Button size="sm" color="pink" onClick={() => showDnsCredentialModal("new")}>
									<T id="dns-credentials.add" />
								</Button>
							) : null}
						</HasPermission>
					</div>
				</div>
				{data?.length ? (
					<div className="card-body border-bottom py-3">
						<div className="row g-2 align-items-center">
							<div className="col-12 col-md">
								<div className="input-group input-group-flat input-group-sm">
									<span className="input-group-text">
										<IconSearch className="icon" aria-hidden="true" />
									</span>
									<input
										type="text"
										className="form-control"
										placeholder={intl.formatMessage({ id: "search" })}
										aria-label={intl.formatMessage({ id: "search" })}
										autoComplete="off"
										onChange={(e) => setSearch(e.target.value.toLowerCase().trim())}
									/>
								</div>
							</div>
						</div>
					</div>
				) : null}
				<Table
					data={filtered ?? data ?? []}
					isFetching={isFetching}
					isFiltered={search}
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
	);
}
