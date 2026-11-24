import { StatusBadge } from "src/components/StatusBadge";
import { TapTooltip } from "src/components/TapTooltip";
import { intl, T } from "src/locale";
import { hostCheckBadge, nameLine } from "src/modules/DnsCheck";

/**
 * The small DNS badge after the domain names of a host in a list: the worst state of the host's names (green here,
 * amber partly or unknown, red elsewhere or none). The tooltip has one line per name. Nothing shows for a host with no
 * checked name (the badge exists only when a cached result does).
 *
 * @param {Object} props
 * @param {Array}  props.names  the names of the host's check
 */
export function DnsCheckBadge({ names }) {
	const badge = hostCheckBadge(names);
	if (badge === null) return null;
	const lines = names.map((result) => ({ name: result.name, line: nameLine(result) }));
	// the accessible name carries the state and the lines of the tooltip, which a focused badge would not read
	const label = [
		intl.formatMessage(
			{ id: "dns-check.badge-label" },
			{ state: intl.formatMessage({ id: `dns-check.state.${badge.state}` }) },
		),
		...lines.map(({ name, line }) => `${name}: ${intl.formatMessage({ id: line.stateId })}`),
	].join(". ");
	return (
		<TapTooltip
			content={
				<ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-left">
					{lines.map(({ name, line }) => (
						<li key={name}>
							<span className="font-mono">{name}</span>: <T id={line.stateId} />
						</li>
					))}
				</ul>
			}
		>
			<StatusBadge tone={badge.tone} className="mr-2" data-dns-check={badge.state} role="img" aria-label={label}>
				<T id="dns-check.badge" />
			</StatusBadge>
		</TapTooltip>
	);
}
