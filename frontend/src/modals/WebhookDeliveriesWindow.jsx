import { ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { useState } from "react";
import { AppModal, Button, ErrorAlert, LoadingPage } from "src/components";
import { StatusBadge } from "src/components/StatusBadge";
import { PagedTable } from "src/components/Table/TablePagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { usePaging, useRedeliverWebhook, useWebhookDeliveries } from "src/hooks";
import { currentLocale, intl, T } from "src/locale";
import { detailOf, formatDeliveryTime, redeliverState, statusKind } from "src/modules/WebhookDeliveries";
import { eventLabelId } from "src/modules/WebhookWindowForms";
import { showApiError, showSuccess } from "src/notifications";

const HEAD = "whitespace-nowrap";
const NONE = <span className="text-muted-foreground">-</span>;

// the error and the response excerpt are plain text from another server: shown as text in a monospace block, never as
// HTML, long lines wrap
function Detail({ title, text }) {
	if (!text) return null;
	return (
		<div className="mb-2 last:mb-0">
			<div className="mb-1 text-xs font-semibold text-muted-foreground">
				<T id={title} />
			</div>
			<pre className="m-0 max-h-60 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs break-all whitespace-pre-wrap">
				{text}
			</pre>
		</div>
	);
}

function Row({ delivery, webhookEnabled, open, onToggle, redelivering, onRedeliver, columns }) {
	const kind = statusKind(delivery.status);
	const detail = detailOf(delivery);
	const redeliver = redeliverState(delivery, webhookEnabled);
	const eventId = eventLabelId(delivery.event);
	const detailId = `webhook-delivery-detail-${delivery.id}`;
	const time = formatDeliveryTime(delivery.createdOn, currentLocale);
	const eventName = eventId ? intl.formatMessage({ id: eventId }) : delivery.event;
	return (
		<>
			<TableRow data-webhook-delivery={delivery.id}>
				<TableCell className="whitespace-nowrap">
					{detail ? (
						<button
							type="button"
							className="me-1 inline-flex size-5 items-center justify-center rounded-sm align-middle hover:bg-muted"
							aria-expanded={open}
							aria-controls={open ? detailId : undefined}
							aria-label={intl.formatMessage(
								{
									id: open
										? "settings.webhooks.deliveries.hide"
										: "settings.webhooks.deliveries.show",
								},
								{ time, event: eventName },
							)}
							onClick={onToggle}
						>
							{open ? (
								<ChevronDown className="size-4" aria-hidden="true" />
							) : (
								<ChevronRight className="size-4" aria-hidden="true" />
							)}
						</button>
					) : (
						<span className="me-1 inline-block size-5 align-middle" aria-hidden="true" />
					)}
					{time}
				</TableCell>
				<TableCell className="wrap-anywhere whitespace-normal">
					{eventId ? <T id={eventId} /> : <span className="font-mono text-sm">{delivery.event}</span>}
				</TableCell>
				<TableCell>
					<StatusBadge tone={kind.tone} dot={false} className="whitespace-nowrap">
						<T id={kind.id} />
					</StatusBadge>
				</TableCell>
				<TableCell>{delivery.attempts}</TableCell>
				<TableCell>{delivery.httpStatus ?? NONE}</TableCell>
				<TableCell className="whitespace-nowrap">
					{delivery.durationMs === null || delivery.durationMs === undefined ? (
						NONE
					) : (
						<T id="settings.webhooks.deliveries.ms" data={{ ms: delivery.durationMs }} />
					)}
				</TableCell>
				<TableCell className="text-right whitespace-normal">
					{redeliver.show ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={redeliver.disabled || redelivering}
							onClick={() => onRedeliver(delivery)}
						>
							<RotateCw aria-hidden="true" />
							<T id="settings.webhooks.deliveries.redeliver" />
						</Button>
					) : null}
					{redeliver.reasonId ? (
						<div className="mt-1 text-xs text-muted-foreground">
							<T id={redeliver.reasonId} />
						</div>
					) : null}
				</TableCell>
			</TableRow>
			{open && detail ? (
				<TableRow id={detailId} data-webhook-delivery-detail={delivery.id}>
					<TableCell colSpan={columns} className="whitespace-normal">
						<Detail title="settings.webhooks.deliveries.error" text={detail.error} />
						<Detail title="settings.webhooks.deliveries.response" text={detail.response} />
					</TableCell>
				</TableRow>
			) : null}
		</>
	);
}

/**
 * The deliveries of one webhook, newest first, paged on the server and refreshed every 10 seconds while the window is
 * open. A row with an error or a response opens it; a failed row whose content is still kept can be sent again.
 */
function WebhookDeliveriesWindow({ webhook, visible, remove }) {
	const [knownTotal, setKnownTotal] = useState(null);
	const paging = usePaging({ list: "webhook-deliveries", total: knownTotal });
	const { isPending, isError, isPlaceholderData, error, rows, total } = useWebhookDeliveries(webhook.id, {
		page: paging.pageIndex,
		size: paging.pageSize,
	});
	if (total !== null && !isPlaceholderData && total !== knownTotal) setKnownTotal(total);
	const redeliver = useRedeliverWebhook(webhook.id);
	// the ids of the rows that are open
	const [openIds, setOpenIds] = useState([]);
	const toggle = (id) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));

	const onRedeliver = async (delivery) => {
		try {
			await redeliver.mutateAsync(delivery.id);
			showSuccess(intl.formatMessage({ id: "settings.webhooks.deliveries.redelivered" }));
		} catch (err) {
			showApiError(err);
		}
	};

	const firstLoadFailed = isError && knownTotal === null;
	const columns = 7;

	return (
		<AppModal show={visible} onHide={remove} size="xl" scrollable data-webhook-deliveries-window>
			<AppModal.Header closeButton>
				<AppModal.Title className="wrap-anywhere">
					<T id="settings.webhooks.deliveries.title" data={{ name: webhook.name }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body className="p-0">
				{isPending ? (
					<LoadingPage noLogo delay={300} />
				) : firstLoadFailed ? (
					<ErrorAlert error={error} className="m-3" />
				) : (
					<PagedTable paging={paging} total={total ?? knownTotal ?? 0}>
						{isError ? <ErrorAlert error={error} className="m-3" /> : null}
						{rows.length === 0 && !isError ? (
							<p className="m-0 p-4 text-muted-foreground" data-webhook-deliveries-empty>
								<T id="settings.webhooks.deliveries.empty" />
							</p>
						) : (
							<Table
								data-webhook-deliveries
								aria-label={intl.formatMessage(
									{ id: "settings.webhooks.deliveries.title" },
									{ name: webhook.name },
								)}
							>
								<TableHeader>
									<TableRow>
										<TableHead className={HEAD}>
											<T id="settings.webhooks.deliveries.time" />
										</TableHead>
										<TableHead className={HEAD}>
											<T id="column.event" />
										</TableHead>
										<TableHead className={HEAD}>
											<T id="column.status" />
										</TableHead>
										<TableHead className={HEAD}>
											<T id="settings.webhooks.deliveries.attempts" />
										</TableHead>
										<TableHead className={HEAD}>
											<T id="settings.webhooks.deliveries.http" />
										</TableHead>
										<TableHead className={HEAD}>
											<T id="settings.webhooks.deliveries.duration" />
										</TableHead>
										<TableHead className={HEAD}>
											<span className="sr-only">
												<T id="settings.webhooks.deliveries.redeliver" />
											</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{rows.map((delivery) => (
										<Row
											key={delivery.id}
											delivery={delivery}
											webhookEnabled={webhook.enabled}
											open={openIds.includes(delivery.id)}
											onToggle={() => toggle(delivery.id)}
											redelivering={redeliver.isPending && redeliver.variables === delivery.id}
											onRedeliver={onRedeliver}
											columns={columns}
										/>
									))}
								</TableBody>
							</Table>
						)}
					</PagedTable>
				)}
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={remove}>
					<T id="action.close" />
				</Button>
			</AppModal.Footer>
		</AppModal>
	);
}

export default WebhookDeliveriesWindow;
