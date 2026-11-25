import { Globe } from "lucide-react";
import { StatusBadge } from "src/components/StatusBadge";
import { TapTooltip } from "src/components/TapTooltip";
import { intl, T } from "src/locale";
import { badgeLines, recordsBadge } from "src/modules/HostDnsRecords";

// the badge's state words, written out whole
const STATE_IDS = {
	ok: "host-dns.badge.ok",
	pending: "host-dns.badge.pending",
	exists: "host-dns.badge.exists",
	paused: "host-dns.badge.paused",
	failed: "host-dns.badge.failed",
	orphan: "host-dns.badge.orphan",
};

/**
 * The globe badge after the domain names of a host that has managed DNS records (the host record option): green when
 * every record is kept updated, amber while one is pending, exists or paused, red when one failed or could not be
 * deleted. Nothing shows for a host without such a record. The tooltip has one line per name.
 *
 * @param {Object} props
 * @param {Array}  props.records  the states of the host (npmproDnsRecords)
 */
export function HostRecordsBadge({ records }) {
	const badge = recordsBadge(records);
	if (badge === null) return null;
	const lines = badgeLines(records);
	const label = [
		intl.formatMessage(
			{ id: "host-dns.badge-label" },
			{ state: intl.formatMessage({ id: STATE_IDS[badge.state] }) },
		),
		...lines.map(({ name, line }) => `${name}: ${intl.formatMessage({ id: line.id }, line.values)}`),
	].join(". ");
	return (
		<TapTooltip
			content={
				<ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-left">
					{lines.map(({ name, line }) => (
						<li key={name}>
							<span className="font-mono">{name}</span>: <T id={line.id} data={line.values} />
						</li>
					))}
				</ul>
			}
		>
			<StatusBadge
				tone={badge.tone}
				className="mr-2"
				data-host-records={badge.state}
				role="img"
				aria-label={label}
			>
				<Globe className="size-3" aria-hidden="true" />
				<T id="host-dns.badge" />
			</StatusBadge>
		</TapTooltip>
	);
}
