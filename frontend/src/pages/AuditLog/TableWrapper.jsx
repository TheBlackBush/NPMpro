import { IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ErrorAlert, LoadingPage } from "src/components";
import { useAuditLogs } from "src/hooks";
import { intl, T } from "src/locale";
import { showEventDetailsModal } from "src/modals";
import Table from "./Table";

export default function TableWrapper() {
	const [search, setSearch] = useState("");
	const { isFetching, isPending, isError, error, data } = useAuditLogs(["user"]);

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
		filtered = data.filter((item) => {
			const metaText = JSON.stringify(item.meta).toLowerCase();
			const value = [item.objectType, item.action, metaText].join(" ");

			return value.includes(search);
		});
	}

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-purple" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="auditlogs" />
							</h2>
						</div>
						{data?.length ? (
							<div className="col-md-auto col-sm-12">
								<div className="ms-auto d-flex flex-wrap btn-list">
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
								</div>
							</div>
						) : null}
					</div>
				</div>
				<Table data={filtered ?? data ?? []} isFetching={isFetching} onSelectItem={showEventDetailsModal} />
			</div>
		</div>
	);
}
