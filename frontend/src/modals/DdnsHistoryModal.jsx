import { AppModal, Button, ErrorAlert, Loading } from "src/components";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { useDdnsHistory, useDdnsRecord } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { IP_VERSIONS } from "src/modules/DdnsForms";
import EasyModal from "src/modules/easyModal";

/** The History window of one dynamic DNS record: its changes and state transitions, newest first */
const showDdnsHistoryModal = (id) => {
	EasyModal.show(DdnsHistoryModal, { id });
};

const HEAD = "whitespace-nowrap";

// the value of an entry: the address, or the CNAME target, or nothing
const cellValue = (value) =>
	value ? (
		<span className="wrap-anywhere font-mono text-sm">{value}</span>
	) : (
		<span className="text-muted-foreground">-</span>
	);

function Kind({ entry }) {
	return (
		<>
			<T id={`ddns.history.kind.${entry.kind}`} />
			{entry.ipVersion ? <span className="text-muted-foreground"> {IP_VERSIONS[entry.ipVersion]}</span> : null}
		</>
	);
}

const DdnsHistoryModal = EasyModal.create(({ id, visible, remove }) => {
	const { data: record } = useDdnsRecord(id);
	const { data: entries, isPending, error } = useDdnsHistory(id);

	return (
		<AppModal show={visible} onHide={remove} size="lg" scrollable data-ddns-history-window>
			<AppModal.Header closeButton>
				<AppModal.Title>
					<T id="ddns.history.title" data={{ name: record?.name ?? "" }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				{error ? <ErrorAlert error={error} /> : null}
				{isPending ? <Loading noLogo /> : null}
				{entries && entries.length === 0 ? (
					<p className="m-0 text-muted-foreground" data-ddns-history-empty>
						<T id="ddns.history.empty" />
					</p>
				) : null}
				{entries && entries.length > 0 ? (
					<Table
						data-ddns-history
						aria-label={intl.formatMessage({ id: "ddns.history.title" }, { name: record?.name ?? "" })}
					>
						<TableHeader>
							<TableRow>
								<TableHead className={HEAD}>
									<T id="ddns.history.date" />
								</TableHead>
								<TableHead className={HEAD}>
									<T id="ddns.history.event" />
								</TableHead>
								<TableHead className={HEAD}>
									<T id="ddns.history.old" />
								</TableHead>
								<TableHead className={HEAD}>
									<T id="ddns.history.new" />
								</TableHead>
								<TableHead className={HEAD}>
									<T id="ddns.history.message" />
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{entries.map((entry) => (
								<TableRow key={entry.id}>
									<TableCell className="whitespace-nowrap">
										{formatDateTime(entry.createdOn)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										<Kind entry={entry} />
									</TableCell>
									<TableCell>{cellValue(entry.oldIp)}</TableCell>
									<TableCell>{cellValue(entry.newIp)}</TableCell>
									<TableCell className="wrap-anywhere whitespace-normal">
										{entry.message ? (
											entry.message
										) : (
											<span className="text-muted-foreground">-</span>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : null}
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={remove}>
					<T id="action.close" />
				</Button>
			</AppModal.Footer>
		</AppModal>
	);
});

export { showDdnsHistoryModal };
