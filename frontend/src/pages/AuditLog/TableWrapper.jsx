import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorAlert, LoadingPage } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import { InputGroup, InputGroupAddon, InputGroupInput } from "src/components/ui/input-group";
import { useAuditLogs, useUsers } from "src/hooks";
import { intl, T } from "src/locale";
import { showEventDetailsModal } from "src/modals";
import { SettingsHeading } from "../Settings/SettingsHeading";
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

// two filters per row on phones (half the row minus half the gap-2; a lone last one grows to the full row), their own width from md
const FILTER_CLASS = "w-auto min-w-[calc(50%-0.25rem)] max-w-full flex-1 md:min-w-0 md:flex-none";

// the empty string means "all" in the query; the select needs a non-empty value for it
function FilterSelect({ label, value, onChange, options }) {
	const name = intl.formatMessage({ id: label });
	return (
		<AppSelect
			size="sm"
			className={FILTER_CLASS}
			aria-label={name}
			value={value || "all"}
			onValueChange={(v) => onChange(v === "all" ? "" : v)}
			options={[{ value: "all", label: `${name}: ${intl.formatMessage({ id: "list.filter.all" })}` }, ...options]}
		/>
	);
}

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
		<section>
			<SettingsHeading titleId="auditlogs" />
			<div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
				<div className="flex flex-wrap items-center gap-2 border-b p-3">
					<InputGroup className="w-full md:min-w-64 md:flex-1">
						<InputGroupAddon>
							<Search aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							type="text"
							placeholder={intl.formatMessage({ id: "search" })}
							aria-label={intl.formatMessage({ id: "search" })}
							autoComplete="off"
							maxLength={255}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</InputGroup>
					{/* the filters sit on the right (search on the left), two per row on phones */}
					<div className="flex w-full flex-wrap items-center justify-end gap-2 md:ml-auto md:w-auto">
						<FilterSelect
							label="audit-log.filter.type"
							value={objectType}
							onChange={setObjectType}
							options={OBJECT_TYPES.map((t) => ({ value: t, label: intl.formatMessage({ id: t }) }))}
						/>
						<FilterSelect
							label="audit-log.filter.action"
							value={action}
							onChange={setAction}
							options={ACTIONS.map((a) => ({
								value: a,
								label: intl.formatMessage({ id: `audit-log.action.${a}` }),
							}))}
						/>
						<FilterSelect
							label="audit-log.filter.user"
							value={userId}
							onChange={setUserId}
							options={(users ?? []).map((u) => ({ value: `${u.id}`, label: u.name }))}
						/>
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
					<div className="flex items-center gap-3 border-t px-4 py-3">
						{total !== null ? (
							<p className="m-0 text-sm text-muted-foreground">
								<T id="audit-log.loaded" data={{ loaded: rows.length, total }} />
							</p>
						) : null}
						{hasNextPage ? (
							<Button className="ml-auto" isLoading={isFetchingNextPage} onClick={() => fetchNextPage()}>
								<T id="audit-log.load-more" />
							</Button>
						) : null}
					</div>
				) : null}
			</div>
		</section>
	);
}
