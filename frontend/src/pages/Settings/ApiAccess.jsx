import { createColumnHelper } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { revokeApiToken } from "src/api/backend";
import { Button as AppButton, ErrorAlert, Loading } from "src/components";
import { TokenBadges, TokenCreated, TokenExpiry, TokenLastUsed, TokenPermissions } from "src/components/ApiTokenCells";
import { SettingLine, SettingLineNote } from "src/components/Form/SettingLine";
import { TableLayout } from "src/components/Table/TableLayout";
import { PagedTable } from "src/components/Table/TablePagination";
import { PAGED_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { Button } from "src/components/ui/button";
import { useAllApiTokens, usePaging } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
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
			<div className="break-words">{owner.name}</div>
			<div className="break-all text-muted-foreground text-sm">{owner.email}</div>
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
					<div className="flex flex-wrap items-center gap-2">
						<span className="break-words font-medium">{info.getValue()}</span>
						<TokenBadges token={info.row.original} now={now} />
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
				cell: (info) => <TokenPermissions token={info.row.original} />,
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
					<AppButton
						size="sm"
						aria-label={label("api-tokens.revoke-name", { name: info.row.original.name })}
						onClick={() => revoke(info.row.original)}
					>
						<T id="api-tokens.revoke" />
					</AppButton>
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
				id="api-access-docs"
				title={<T id="settings.api-access.docs.openapi" />}
				control={
					<Button asChild variant="outline" size="sm">
						<a href="/api/docs" target="_blank" rel="noopener noreferrer">
							<T id="api-tokens.docs" />
							<ExternalLink aria-hidden="true" />
						</a>
					</Button>
				}
			/>
			<SettingLineNote className="text-muted-foreground text-sm">
				<T id="api-tokens.docs.note" /> <code className="font-mono">Authorization: Bearer YOUR_TOKEN</code>
			</SettingLineNote>
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
