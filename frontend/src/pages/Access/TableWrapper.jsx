import { IconHelp, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { deleteAccessList } from "src/api/backend";
import { Button, ErrorAlert, HasPermission, LoadingPage } from "src/components";
import { useAccessLists } from "src/hooks";
import { intl, T } from "src/locale";
import { showAccessListModal, showDeleteConfirmModal, showHelpModal } from "src/modals";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import Table from "./Table";

export default function TableWrapper() {
	const [search, setSearch] = useState("");
	const { isFetching, isPending, isError, error, data } = useAccessLists(["owner", "items", "clients"]);

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
			<div className="card-status-top bg-cyan" />
			<div className="card-table">
				<div className="card-header">
					<h2 className="card-title">
						<T id="access-lists" />
					</h2>
					<div className="card-actions btn-list">
						<Button
							size="sm"
							className="btn-icon"
							aria-label={intl.formatMessage({ id: "help" })}
							title={intl.formatMessage({ id: "help" })}
							onClick={() => showHelpModal("AccessLists")}
						>
							<IconHelp className="icon" aria-hidden="true" />
						</Button>
						<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
							{data?.length ? (
								<Button size="sm" color="cyan" onClick={() => showAccessListModal("new")}>
									<T id="object.add" tData={{ object: "access-list" }} />
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
			</div>
		</div>
	);
}
