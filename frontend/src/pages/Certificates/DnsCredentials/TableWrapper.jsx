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
		return <LoadingPage />;
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
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="dns-credentials" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<div className="ms-auto d-flex flex-wrap btn-list">
								{data?.length ? (
									<div className="input-group input-group-flat input-group-sm w-auto">
										<span className="input-group-text">
											<IconSearch size={16} />
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
										<Button
											size="sm"
											className="btn-pink"
											onClick={() => showDnsCredentialModal("new")}
										>
											<T id="dns-credentials.add" />
										</Button>
									) : null}
								</HasPermission>
							</div>
						</div>
					</div>
				</div>
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
