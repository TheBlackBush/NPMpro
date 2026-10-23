import { IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ErrorAlert, LoadingPage } from "src/components";
import { useAuditLogs, useUsers } from "src/hooks";
import { intl, T } from "src/locale";
import { showEventDetailsModal } from "src/modals";
import Table from "./Table";

const OBJECT_TYPES = [
	"proxy-host",
	"redirection-host",
	"dead-host",
	"stream",
	"access-list",
	"certificate",
	"dns-credential",
	"user",
	"setting",
];
const ACTIONS = ["created", "updated", "deleted", "enabled", "disabled"];

export default function TableWrapper() {
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [objectType, setObjectType] = useState("");
	const [action, setAction] = useState("");
	const [userId, setUserId] = useState("");
	const { data: users } = useUsers();

	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const {
		isFetching,
		isFetchingNextPage,
		isPending,
		isError,
		isFetchNextPageError,
		error,
		rows,
		total,
		hasNextPage,
		fetchNextPage,
	} = useAuditLogs(["user"], { query, objectType, action, userId });

	if (isPending) {
		return <LoadingPage />;
	}

	// A failed next page keeps the loaded rows, only a failed first load replaces the page
	if (isError && !isFetchNextPageError && !rows.length) {
		return <ErrorAlert error={error} />;
	}

	const filtered = Boolean(query || objectType || action || userId);

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
						<div className="col-md-auto col-sm-12">
							<div className="ms-auto d-flex flex-wrap gap-2 align-items-center">
								<select
									className="form-select form-select-sm w-auto"
									aria-label={intl.formatMessage({ id: "audit-log.filter.type" })}
									value={objectType}
									onChange={(e) => setObjectType(e.target.value)}
								>
									<option value="">
										{intl.formatMessage({ id: "audit-log.filter.type" })}:{" "}
										{intl.formatMessage({ id: "list.filter.all" })}
									</option>
									{OBJECT_TYPES.map((t) => (
										<option key={t} value={t}>
											{intl.formatMessage({ id: t })}
										</option>
									))}
								</select>
								<select
									className="form-select form-select-sm w-auto"
									aria-label={intl.formatMessage({ id: "audit-log.filter.action" })}
									value={action}
									onChange={(e) => setAction(e.target.value)}
								>
									<option value="">
										{intl.formatMessage({ id: "audit-log.filter.action" })}:{" "}
										{intl.formatMessage({ id: "list.filter.all" })}
									</option>
									{ACTIONS.map((a) => (
										<option key={a} value={a}>
											{intl.formatMessage({ id: `audit-log.action.${a}` })}
										</option>
									))}
								</select>
								<select
									className="form-select form-select-sm w-auto"
									aria-label={intl.formatMessage({ id: "audit-log.filter.user" })}
									value={userId}
									onChange={(e) => setUserId(e.target.value)}
								>
									<option value="">
										{intl.formatMessage({ id: "audit-log.filter.user" })}:{" "}
										{intl.formatMessage({ id: "list.filter.all" })}
									</option>
									{(users ?? []).map((u) => (
										<option key={u.id} value={u.id}>
											{u.name}
										</option>
									))}
								</select>
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
										value={search}
										onChange={(e) => setSearch(e.target.value)}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
				<Table
					data={rows}
					isFetching={isFetching && !isFetchingNextPage}
					onSelectItem={showEventDetailsModal}
				/>
				{isFetchNextPageError ? <ErrorAlert error={error} className="m-3" /> : null}
				{rows.length && (hasNextPage || filtered || total !== null) ? (
					<div className="card-footer d-flex align-items-center gap-3">
						{hasNextPage ? (
							<button
								type="button"
								className="btn btn-sm"
								disabled={isFetchingNextPage}
								onClick={() => fetchNextPage()}
							>
								{isFetchingNextPage ? <span className="spinner-border spinner-border-sm me-2" /> : null}
								<T id="audit-log.load-more" />
							</button>
						) : null}
						{total !== null ? (
							<span className="text-secondary">
								<T id="audit-log.loaded" data={{ loaded: rows.length, total }} />
							</span>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
