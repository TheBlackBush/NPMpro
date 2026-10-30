import { IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button, ErrorAlert, LoadingPage } from "src/components";
import { useAuditLogs, useUsers } from "src/hooks";
import { intl, T } from "src/locale";
import { showEventDetailsModal } from "src/modals";
import { stripeClass } from "src/modules/SectionColors";
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
	"backup-schedule",
	"database",
];
const ACTIONS = [
	"created",
	"updated",
	"deleted",
	"enabled",
	"disabled",
	"backup-succeeded",
	"backup-failed",
	"moved",
	"move-failed",
];

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
		return <LoadingPage noLogo delay={300} />;
	}

	// A failed next page keeps the loaded rows, a failed first load shows the error under the toolbar
	const firstPageFailed = isError && !isFetchNextPageError && !rows.length;

	const filtered = Boolean(query || objectType || action || userId);

	return (
		<div className="card mt-4">
			<div className={stripeClass("auditLog")} />
			<div className="card-table">
				<div className="card-header">
					<h2 className="card-title">
						<T id="auditlogs" />
					</h2>
				</div>
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
									maxLength={255}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
							</div>
						</div>
						<div className="col-6 col-md-auto">
							<select
								className="form-select form-select-sm w-100"
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
						</div>
						<div className="col-6 col-md-auto">
							<select
								className="form-select form-select-sm w-100"
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
						</div>
						<div className="col-6 col-md-auto">
							<select
								className="form-select form-select-sm w-100"
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
						</div>
					</div>
				</div>
				{firstPageFailed ? (
					<ErrorAlert error={error} className="m-3" />
				) : (
					<Table
						data={rows}
						isFetching={isFetching && !isFetchingNextPage}
						onSelectItem={showEventDetailsModal}
					/>
				)}
				{isFetchNextPageError ? <ErrorAlert error={error} className="m-3" /> : null}
				{rows.length && (hasNextPage || filtered || total !== null) ? (
					<div className="card-footer d-flex align-items-center">
						{total !== null ? (
							<p className="m-0 text-secondary">
								<T id="audit-log.loaded" data={{ loaded: rows.length, total }} />
							</p>
						) : null}
						{hasNextPage ? (
							<Button className="ms-auto" isLoading={isFetchingNextPage} onClick={() => fetchNextPage()}>
								<T id="audit-log.load-more" />
							</Button>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
