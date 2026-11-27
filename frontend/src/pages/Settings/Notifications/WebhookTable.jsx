import { createColumnHelper } from "@tanstack/react-table";
import { KeyRound, Pause, Play, Plus, Send, SquarePen, Trash2, Webhook } from "lucide-react";
import { useMemo, useState } from "react";
import { deleteWebhook, rotateWebhookSecret } from "src/api/backend";
import { Button, EmptyData, ErrorAlert, Loading, RowActions } from "src/components";
import { StatusBadge } from "src/components/StatusBadge";
import { TableLayout } from "src/components/Table/TableLayout";
import { useAppTable } from "src/components/Table/useAppTable";
import { Spinner } from "src/components/ui/spinner";
import { useSaveWebhook, useTestWebhook, useWebhooks, WEBHOOK_INVALIDATIONS } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDeleteConfirmModal, showWebhookModal, showWebhookSecretModal } from "src/modals";
import { WRAP_BADGE } from "src/modules/Badges";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { deliveryStateId, eventsLabel, FAILING_DAYS, needsUrl, statusOf, testOutcome } from "src/modules/WebhookForms";
import { showApiError, showError, showObjectSuccess, showSuccess } from "src/notifications";
import { SettingsCard } from "../SettingsCard";

const label = (id, values) => intl.formatMessage({ id }, values);

const BADGE_TONES = { active: "success", failing: "warning", disabled: "muted", error: "destructive" };
const BADGE_TEXTS = {
	active: "settings.webhooks.status.active",
	failing: "settings.webhooks.status.failing",
	disabled: "settings.webhooks.status.disabled",
	error: "settings.webhooks.status.error",
};

const reasonText = (webhook) => {
	const { reasonKey } = statusOf(webhook);
	if (!reasonKey) return null;
	return label(reasonKey, {
		since: webhook.failingSince ? formatDateTime(webhook.failingSince) : "",
		days: FAILING_DAYS,
	});
};

const eventsText = (webhook) => {
	const { id, values } = eventsLabel(webhook.events);
	return label(id, values);
};

const deliveryText = (webhook) => {
	const stateId = deliveryStateId(webhook.lastDelivery);
	if (!stateId) return label("settings.webhooks.delivery.none");
	const { httpStatus, createdOn } = webhook.lastDelivery;
	return [label(stateId), httpStatus ? `HTTP ${httpStatus}` : null, formatDateTime(createdOn)]
		.filter(Boolean)
		.join(", ");
};

function Status({ webhook }) {
	const { kind } = statusOf(webhook);
	const reason = reasonText(webhook);
	return (
		<>
			<StatusBadge tone={BADGE_TONES[kind]} dot={false} className={WRAP_BADGE}>
				<T id={BADGE_TEXTS[kind]} />
			</StatusBadge>
			{reason ? <div className="mt-1 text-sm text-muted-foreground wrap-anywhere">{reason}</div> : null}
		</>
	);
}

function Url({ webhook }) {
	if (!webhook.urlSet) {
		return (
			<span className="text-muted-foreground">
				<T id="settings.webhooks.url.not-set" />
			</span>
		);
	}
	return <span className="font-mono text-sm break-all">{webhook.urlHint}</span>;
}

function LastDelivery({ webhook }) {
	if (!webhook.lastDelivery) {
		return (
			<span className="text-muted-foreground">
				<T id="settings.webhooks.delivery.none" />
			</span>
		);
	}
	const { httpStatus, createdOn } = webhook.lastDelivery;
	const stateId = deliveryStateId(webhook.lastDelivery);
	return (
		<>
			<div>
				{stateId ? <T id={stateId} /> : null}
				{httpStatus ? <span className="text-muted-foreground">{`, HTTP ${httpStatus}`}</span> : null}
			</div>
			<div className="text-sm text-muted-foreground">{formatDateTime(createdOn)}</div>
		</>
	);
}

function Actions({ webhook, testing, onEdit, onTest, onRotate, onToggle, onDelete }) {
	return (
		<RowActions
			label={label("list.row-actions", { name: webhook.name })}
			focusKey={`webhook-${webhook.id}`}
			title={webhook.name}
			items={[
				{
					key: "edit",
					label: <T id="action.edit" />,
					icon: SquarePen,
					primary: true,
					ariaLabel: label("list.row-edit", { name: webhook.name }),
					onSelect: () => onEdit(webhook),
				},
				{
					key: "test",
					label: testing ? (
						<span className="flex items-center gap-2">
							<T id="settings.webhooks.testing" />
							<Spinner aria-hidden="true" />
						</span>
					) : (
						<T id="settings.webhooks.test" />
					),
					icon: Send,
					disabled: !webhook.urlSet || testing,
					onSelect: () => onTest(webhook),
				},
				{
					key: "rotate",
					label: <T id="settings.webhooks.rotate" />,
					icon: KeyRound,
					onSelect: () => onRotate(webhook),
				},
				{
					key: "toggle",
					label: <T id={webhook.enabled ? "action.disable" : "action.enable"} />,
					icon: webhook.enabled ? Pause : Play,
					onSelect: () => onToggle(webhook),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					destructive: true,
					separatorBefore: true,
					onSelect: () => onDelete(webhook),
				},
			]}
		/>
	);
}

function Table({ data, testing, addButton, handlers }) {
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("column.name"),
				cell: (info) => <span className="wrap-anywhere">{info.getValue()}</span>,
			}),
			columnHelper.display({
				id: "status",
				meta: { mobile: "title-below" },
				header: label("column.status"),
				cell: (info) => <Status webhook={info.row.original} />,
			}),
			columnHelper.accessor((row) => (row.urlSet ? row.urlHint : ""), {
				id: "url",
				enableSorting: false,
				meta: { mobile: "summary", summaryText: (row) => (row.urlSet ? row.urlHint : "") },
				header: label("settings.webhooks.url"),
				cell: (info) => <Url webhook={info.row.original} />,
			}),
			columnHelper.accessor((row) => eventsText(row), {
				id: "events",
				enableSorting: false,
				meta: { mobile: "summary", summaryText: (row) => eventsText(row) },
				header: label("settings.webhooks.events"),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.lastDelivery?.createdOn ?? "", {
				id: "lastDelivery",
				meta: { mobile: "summary", summaryText: (row) => deliveryText(row) },
				header: label("settings.webhooks.delivery.last"),
				cell: (info) => <LastDelivery webhook={info.row.original} />,
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<Actions
						webhook={info.row.original}
						testing={info.table.options.meta?.testing.includes(info.row.original.id)}
						{...info.table.options.meta?.handlers}
					/>
				),
				meta: { className: "text-right whitespace-nowrap", mobile: "title-end" },
			}),
		];
	}, []);

	const tableInstance = useAppTable({ columns, data, meta: { testing, handlers } });

	return (
		<TableLayout
			stackBy="container"
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={Webhook}
					object="webhook"
					objects="webhooks"
					tableInstance={tableInstance}
					customAddBtn={addButton}
					permissionSection={ADMIN}
					permission={VIEW}
				/>
			}
		/>
	);
}

/**
 * The webhooks with their status, events and last delivery, and Edit, Send test, Rotate secret, Enable or Disable and
 * Delete per webhook. A test answers when the receiver has; the row shows a spinner until then.
 */
function WebhooksCard() {
	const { data, isPending, error } = useWebhooks();
	const test = useTestWebhook();
	const save = useSaveWebhook();
	// the ids of the webhooks whose Send test is pending
	const [testing, setTesting] = useState([]);

	const handlers = useMemo(
		() => ({
			onEdit: (webhook) => showWebhookModal(webhook),
			onTest: async (webhook) => {
				setTesting((ids) => [...ids, webhook.id]);
				try {
					const outcome = testOutcome(await test.mutateAsync(webhook.id));
					const text = label(outcome.id, outcome.values);
					if (outcome.ok) showSuccess(text);
					else showError(text);
				} catch (err) {
					// the shared test limiter answers 429 in English: show the translated text
					if (err?.status === 429) showError(label("error.too-many-requests"));
					else showApiError(err);
				} finally {
					setTesting((ids) => ids.filter((id) => id !== webhook.id));
				}
			},
			onRotate: (webhook) => {
				showDeleteConfirmModal({
					title: <T id="settings.webhooks.rotate.title" />,
					confirmLabel: <T id="settings.webhooks.rotate" />,
					confirmVariant: "default",
					subject: webhook.name,
					children: <T id="settings.webhooks.rotate.text" />,
					onConfirm: async () => {
						const rotated = await rotateWebhookSecret(webhook.id);
						showWebhookSecretModal(rotated.name ?? webhook.name, rotated.secret);
					},
					invalidations: WEBHOOK_INVALIDATIONS,
				});
			},
			onToggle: async (webhook) => {
				// a webhook without its URL (restored from a backup) cannot be turned on before the URL is entered
				if (!webhook.enabled && needsUrl(webhook)) {
					showWebhookModal(webhook);
					return;
				}
				try {
					await save.mutateAsync({ id: webhook.id, enabled: !webhook.enabled });
					showObjectSuccess("webhook", webhook.enabled ? "disabled" : "enabled");
				} catch (err) {
					showApiError(err);
				}
			},
			onDelete: (webhook) => {
				showDeleteConfirmModal({
					title: <T id="object.delete" tData={{ object: "webhook" }} />,
					subject: webhook.name,
					details: webhook.urlSet ? webhook.urlHint : null,
					onConfirm: async () => {
						await deleteWebhook(webhook.id);
						showObjectSuccess("webhook", "deleted");
					},
					invalidations: WEBHOOK_INVALIDATIONS,
				});
			},
		}),
		[test.mutateAsync, save.mutateAsync],
	);

	const addButton = (
		<Button size="sm" onClick={() => showWebhookModal(null)}>
			<Plus aria-hidden="true" />
			<T id="settings.webhooks.add" />
		</Button>
	);

	return (
		<SettingsCard
			id="notifications-webhooks"
			title={<T id="settings.webhooks" />}
			actions={data?.length ? addButton : null}
			info={<T id="settings.webhooks.info" />}
			bodyClassName="space-y-0 p-0"
		>
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="p-4">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data ? <Table data={data} testing={testing} addButton={addButton} handlers={handlers} /> : null}
		</SettingsCard>
	);
}

export default WebhooksCard;
