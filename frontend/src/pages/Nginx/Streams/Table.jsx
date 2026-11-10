import { Disc3 } from "lucide-react";
import { useMemo } from "react";
import { BreakableHost } from "src/components/Table/Formatter/BreakableHost";
import { ValueWithDateFormatter } from "src/components/Table/Formatter/ValueWithDateFormatter";
import { HostTable } from "src/components/Table/HostTable";
import {
	actionsColumn,
	certificateColumn,
	idColumn,
	ownerColumn,
	statusColumn,
} from "src/components/Table/hostColumns";
import { appColumnHelper as columnHelper } from "src/components/Table/useAppTable";
import { Badge } from "src/components/ui/badge";
import { intl, T } from "src/locale";
import { STREAMS } from "src/modules/Permissions";

const ROW = {
	permission: STREAMS,
	object: "stream",
	rowName: (stream) => String(stream.incomingPort ?? `#${stream.id}`),
};
const EMPTY = { icon: Disc3, section: STREAMS, object: "stream", objects: "streams" };

const streamDestination = (row) => `${row.forwardingHost}${row.forwardingPort ? `:${row.forwardingPort}` : ""}`;
const streamProtocols = (row) => {
	const protocols = [];
	if (row.tcpForwarding) protocols.push("TCP");
	if (row.npmproProxyProtocolForwarding) {
		protocols.push(row.npmproProxyProtocolForwarding === 1 ? "PPv1" : "PPv2");
	}
	if (row.npmproProxyTls) protocols.push("TLS");
	if (row.udpForwarding) protocols.push("UDP");
	return protocols;
};
// upstream TLS gets its own words, so it does not read like the certificate's "TLS" / "No TLS" next to it
const protocolSummary = (row) => {
	const transport = streamProtocols(row).filter((protocol) => protocol !== "TLS");
	const parts = [transport.join("/"), row.npmproProxyTls ? intl.formatMessage({ id: "streams.tls" }) : ""];
	return parts.filter(Boolean).join(" · ") || null;
};

// shared with the list page, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns() {
	return useMemo(
		() => [
			ownerColumn(),
			columnHelper.accessor((row) => row.incomingPort, {
				id: "incomingPort",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.incoming-port" }),
				cell: (info) => {
					const value = info.row.original;
					return <ValueWithDateFormatter value={value.incomingPort} createdOn={value.createdOn} />;
				},
			}),
			columnHelper.accessor((row) => row.npmproDescription, {
				id: "npmproDescription",
				meta: { mobile: "summary", summaryText: (row) => row.npmproDescription || null },
				header: intl.formatMessage({ id: "column.description" }),
				cell: (info) => {
					const value = info.row.original.npmproDescription;
					return value || null;
				},
			}),
			columnHelper.accessor(streamDestination, {
				id: "destination",
				meta: { mobile: "summary", summaryText: streamDestination },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => <BreakableHost value={info.getValue()} />,
			}),
			columnHelper.accessor((row) => streamProtocols(row).join(" "), {
				id: "protocol",
				meta: { mobile: "summary", summaryText: protocolSummary },
				header: intl.formatMessage({ id: "column.protocol" }),
				cell: (info) => {
					const value = info.row.original;
					return (
						<div className="flex flex-wrap gap-1">
							{value.tcpForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.tcp" />
								</Badge>
							) : null}
							{value.npmproProxyProtocolForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T
										id={
											value.npmproProxyProtocolForwarding === 1
												? "streams.pp.v1"
												: "streams.pp.v2"
										}
									/>
								</Badge>
							) : null}
							{value.npmproProxyTls ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.tls" />
								</Badge>
							) : null}
							{value.udpForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.udp" />
								</Badge>
							) : null}
						</div>
					);
				},
			}),
			certificateColumn(),
			statusColumn(),
			idColumn(),
			actionsColumn(ROW),
		],
		[],
	);
}

export default function Table(props) {
	return <HostTable {...props} columns={useColumns()} empty={EMPTY} />;
}
