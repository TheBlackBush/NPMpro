import { createColumnHelper } from "@tanstack/react-table";
import { BookOpen, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { revokeApiToken } from "src/api/backend";
import { ErrorAlert, Loading } from "src/components";
import { TokenBadges, TokenCreated, TokenExpiry, TokenLastUsed, TokenPermissions } from "src/components/ApiTokenCells";
import { CodeBox } from "src/components/CodeBox";
import { SettingLine } from "src/components/Form/SettingLine";
import { TableLayout } from "src/components/Table/TableLayout";
import { PagedTable } from "src/components/Table/TablePagination";
import { PAGED_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { Button } from "src/components/ui/button";
import { useAllApiTokens, usePaging } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { authHeader, tokenMarks } from "src/modules/ApiTokens";
import { showSuccess } from "src/notifications";
import { McpCard } from "./McpCard";
import { SettingsCard } from "./SettingsCard";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsLead } from "./SettingsLead";

const label = (id, values) => intl.formatMessage({ id }, values);

const revoke = (token) =>
	showDeleteConfirmModal({
		title: <T id="api-tokens.revoke" />,
		confirmLabel: <T id="api-tokens.revoke" />,
		subject: token.name,
		details: token.owner ? `${token.owner.name} (${token.owner.email})` : null,
		onConfirm: async () => {
			await revokeApiToken(token.id);
			showSuccess(label("api-tokens.revoked"));
		},
		invalidations: [["api-tokens"], ["audit-logs"]],
		children: <T id="api-tokens.revoke.confirm" data={{ name: token.name }} />,
	});

function Owner({ owner }) {
	if (!owner) return <span className="text-muted-foreground">{label("user.deleted")}</span>;
	return (
		<div className="min-w-0">
			<div className="max-w-64 truncate" title={owner.name}>
				{owner.name}
			</div>
			<div className="max-w-64 truncate text-muted-foreground text-sm" title={owner.email}>
				{owner.email}
			</div>
		</div>
	);
}

function TokensTable({ data }) {
	// one moment per mount: a new Date on every render would rebuild the columns each time
	const [now] = useState(() => new Date());
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("api-tokens.name"),
				cell: (info) => (
					<div className="flex min-w-0 flex-col gap-1.5">
						<span className="break-words font-medium">{info.getValue()}</span>
						{tokenMarks(info.row.original, now).length > 0 ? (
							<div className="flex flex-wrap gap-1.5">
								<TokenBadges token={info.row.original} now={now} />
							</div>
						) : null}
					</div>
				),
			}),
			columnHelper.accessor((row) => row.owner?.name ?? "", {
				id: "owner",
				meta: { mobile: "title-below" },
				header: label("settings.api-access.owner"),
				cell: (info) => <Owner owner={info.row.original.owner} />,
			}),
			columnHelper.display({
				id: "permissions",
				header: label("api-tokens.permissions"),
				cell: (info) => <TokenPermissions token={info.row.original} visibility />,
			}),
			columnHelper.accessor((row) => row.expiresOn ?? "", {
				id: "expires",
				header: label("api-tokens.expires"),
				cell: (info) => (
					<span className="whitespace-nowrap">
						<TokenExpiry token={info.row.original} />
					</span>
				),
			}),
			columnHelper.accessor((row) => row.lastUsedOn ?? "", {
				id: "lastUsed",
				header: label("api-tokens.last-used"),
				cell: (info) => (
					<span className="whitespace-nowrap">
						<TokenLastUsed token={info.row.original} />
					</span>
				),
			}),
			columnHelper.accessor((row) => row.createdOn ?? "", {
				id: "created",
				meta: { mobile: "hide" },
				header: label("api-tokens.created"),
				cell: (info) => (
					<span className="whitespace-nowrap">
						<TokenCreated token={info.row.original} />
					</span>
				),
			}),
			columnHelper.display({
				id: "actions",
				meta: { mobile: "title-end", className: "text-right whitespace-nowrap" },
				cell: (info) => (
					<Button
						variant="destructive-outline"
						size="sm"
						aria-label={label("api-tokens.revoke-name", { name: info.row.original.name })}
						onClick={() => revoke(info.row.original)}
					>
						<T id="api-tokens.revoke" />
					</Button>
				),
			}),
		];
	}, [now]);
	const [sorting, setSorting] = useState([]);
	const paging = usePaging({ list: "api-tokens", total: data.length, signature: JSON.stringify(sorting) });
	const tableInstance = useAppTable({
		features: PAGED_FEATURES,
		columns,
		data,
		state: { sorting, pagination: { pageIndex: paging.pageIndex, pageSize: paging.pageSize } },
		onSortingChange: setSorting,
	});
	return (
		<PagedTable paging={paging} total={data.length}>
			<TableLayout stackBy="container" tableInstance={tableInstance} />
		</PagedTable>
	);
}

function TokensCard() {
	const { data, isPending, error } = useAllApiTokens();
	return (
		<SettingsCard
			title={<T id="settings.api-access.tokens" />}
			info={<T id="settings.api-access.tokens.info" />}
			bodyClassName="space-y-0 p-0"
		>
			{error ? (
				<div className="p-4">
					<ErrorAlert error={error} />
				</div>
			) : null}
			{isPending ? (
				<div className="p-4">
					<Loading noLogo />
				</div>
			) : null}
			{data && data.length === 0 ? (
				<p className="m-0 p-6 text-center text-muted-foreground">
					<T id="settings.api-access.empty" />
				</p>
			) : null}
			{data && data.length > 0 ? <TokensTable data={data} /> : null}
		</SettingsCard>
	);
}

function DocsCard() {
	return (
		<SettingsCard title={<T id="settings.api-access.docs" />} lines>
			<SettingLine
				id="api-access-reference"
				title={<T id="api-tokens.reference" />}
				hint={<T id="settings.api-access.docs.reference.hint" />}
				controlClassName="@lg:w-auto"
				control={
					<Button asChild variant="outline" size="sm">
						<a href="/api-reference" target="_blank" rel="noopener noreferrer">
							<BookOpen aria-hidden="true" />
							<T id="settings.api-access.docs.open" />
							<ExternalLink aria-hidden="true" />
							<span className="sr-only">
								{" "}
								<T id="api-tokens.new-tab" />
							</span>
						</a>
					</Button>
				}
			/>
			<SettingLine
				id="api-access-header"
				layout="block"
				title={<T id="settings.api-access.docs.header" />}
				hint={<T id="settings.api-access.docs.header.hint" />}
				control={<CodeBox text={authHeader()} />}
			/>
		</SettingsCard>
	);
}

/**
 * Settings, API access: every token of every user, with revoke, and the link to the API documentation
 */
export default function ApiAccess() {
	return (
		<section className="space-y-4">
			<SettingsHeading titleId="settings.api-access" />
			<SettingsLead id="settings.api-access.intro" />
			<TokensCard />
			<DocsCard />
			<McpCard />
		</section>
	);
}
