import { Copy, Eye, Power, SquarePen, Trash2 } from "lucide-react";
import { RowActions } from "src/components/RowActions";
import { useCanManage } from "src/hooks/useUser";
import { intl, T } from "src/locale";
import { CertificateFormatter } from "./Formatter/CertificateFormatter";
import { DomainsFormatter } from "./Formatter/DomainsFormatter";
import { GravatarFormatter } from "./Formatter/GravatarFormatter";
import { StatusFormatter } from "./Formatter/StatusFormatter";
import { appColumnHelper as columnHelper } from "./useAppTable";

// The columns and the row menu the four host lists share. Columns keep their identity between renders (build them
// in a useMemo with no dependencies; a language change reloads the page): flexRender renders a cell function as a
// component, so a new one would remount every cell. Row handlers reach the cells through the table meta (meta.actions),
// never through the columns.

export const tlsSummary = (row) => intl.formatMessage({ id: row.certificate ? "column.ssl" : "no-tls" });

// The Edit (View for a user who may only view) button, then the menu: Clone, Enable or Disable, Delete
function HostRowActions({ host, permission, object, name, onClone, onDelete, onDisableToggle, onEdit }) {
	const canManage = useCanManage(permission);
	return (
		<RowActions
			label={intl.formatMessage({ id: "list.row-actions" }, { name })}
			focusKey={`${object}-${host.id}`}
			title={<T id="object.actions-title" tData={{ object }} data={{ id: host.id }} />}
			items={[
				{
					key: "edit",
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? SquarePen : Eye,
					primary: true,
					ariaLabel: canManage
						? intl.formatMessage({ id: "list.row-edit" }, { name })
						: intl.formatMessage({ id: "list.row-view" }, { name }),
					onSelect: () => onEdit?.(host.id),
				},
				{
					key: "clone",
					label: <T id="action.clone" />,
					icon: Copy,
					onSelect: () => onClone?.(host.id),
					hidden: !canManage,
				},
				{
					key: "toggle",
					label: <T id={host.enabled ? "action.disable" : "action.enable"} />,
					icon: Power,
					onSelect: () => onDisableToggle?.(host.id, !host.enabled),
					hidden: !canManage,
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(host.id),
					destructive: true,
					separatorBefore: true,
					hidden: !canManage,
				},
			]}
		/>
	);
}

export const ownerColumn = () =>
	columnHelper.accessor((row) => row.owner?.name, {
		id: "owner",
		enableSorting: false,
		cell: (info) => {
			const value = info.row.original.owner;
			return (
				<GravatarFormatter
					url={value ? value.avatar : ""}
					name={value ? value.name : intl.formatMessage({ id: "user.deleted" })}
				/>
			);
		},
		meta: {
			className: "whitespace-nowrap",
			mobile: "hide-lg",
		},
	});

export const domainsColumn = () =>
	columnHelper.accessor((row) => row.domainNames.join(", "), {
		id: "domainNames",
		meta: { mobile: "title" },
		header: intl.formatMessage({ id: "column.source" }),
		cell: (info) => {
			const value = info.row.original;
			return <DomainsFormatter domains={value.domainNames} createdOn={value.createdOn} />;
		},
	});

export const certificateColumn = () =>
	columnHelper.accessor((row) => (row.certificate ? row.certificate.provider : "http-only"), {
		id: "certificate",
		meta: { mobile: "summary", summaryText: tlsSummary },
		header: intl.formatMessage({ id: "column.ssl" }),
		cell: (info) => <CertificateFormatter certificate={info.row.original.certificate} />,
	});

export const statusColumn = () =>
	columnHelper.accessor(
		(row) => {
			if (!row.enabled) return "3disabled";
			if (row.npmproNginxOnline) return "2online";
			return "1offline";
		},
		{
			id: "enabled",
			meta: { mobile: "title-below" },
			header: intl.formatMessage({ id: "column.status" }),
			cell: (info) => {
				const value = info.row.original;
				return (
					<StatusFormatter
						enabled={value.enabled}
						nginxOnline={value.npmproNginxOnline}
						nginxErr={value.npmproNginxErr}
					/>
				);
			},
		},
	);

export const idColumn = () =>
	columnHelper.accessor((row) => row.id, {
		id: "id",
		header: "ID",
		cell: (info) => info.getValue(),
		meta: {
			className: "w-px whitespace-nowrap",
			mobile: "hide-lg",
		},
	});

/**
 * @param {Object}   type
 * @param {string}   type.permission  the permission section (DEAD_HOSTS, ...)
 * @param {string}   type.object      the object key (dead-host, ...): menu title and focus key
 * @param {Function} type.rowName     (row) => the name in the button's label, what the row shows first
 */
export const actionsColumn = ({ permission, object, rowName }) =>
	columnHelper.display({
		id: "actions",
		cell: (info) => (
			<HostRowActions
				host={info.row.original}
				permission={permission}
				object={object}
				name={rowName(info.row.original)}
				{...info.table.options.meta?.actions}
			/>
		),
		meta: {
			className: "text-right whitespace-nowrap",
			mobile: "title-end",
		},
	});
