import { Globe } from "lucide-react";
import { useWatch } from "react-hook-form";
import { Button } from "src/components/Button";
import { StatusBadge } from "src/components/StatusBadge";
import { useCheckHostDns, useHostDnsChecks } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { cardLines, checkCounts, checkOfHost, nameLine, namesChanged } from "src/modules/DnsCheck";
import { showApiError, showSuccess } from "src/notifications";
import { SettingsCard } from "src/pages/Settings/SettingsCard";
import { KeepUpdatedButton, useKeepUpdated } from "./KeepUpdatedHint";

const NOTE = "px-4 py-3 text-sm text-muted-foreground";

// one name: its state, the addresses it answers, how it was found, why it was not checked, and Keep updated
function NameLine({ name, result, keepUpdated, onKeepUpdated }) {
	const line = result ? nameLine(result) : null;
	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm" data-dns-name={name}>
			<span className="font-mono wrap-anywhere">{name}</span>
			{line ? (
				<StatusBadge tone={line.tone} data-dns-state={line.state}>
					<T id={line.stateId} />
				</StatusBadge>
			) : (
				<span className="text-muted-foreground">
					<T id="dns-check.not-checked" />
				</span>
			)}
			{line?.proxied ? (
				<StatusBadge tone="info" dot={false}>
					<T id="dns-check.proxied" />
				</StatusBadge>
			) : null}
			{line?.addresses.length ? (
				<span className="font-mono text-xs text-muted-foreground wrap-anywhere">
					{line.addresses.join(", ")}
				</span>
			) : null}
			{line?.via ? (
				<span className="text-muted-foreground">
					<T id={line.via.id} data={line.via.values} />
				</span>
			) : null}
			{line?.reason ? (
				<span className="text-muted-foreground">
					<T id={line.reason.id} />
					{line.reason.detail ? `: ${line.reason.detail}` : null}
				</span>
			) : null}
			{keepUpdated ? <KeepUpdatedButton entry={keepUpdated} onOpen={onKeepUpdated} /> : null}
		</li>
	);
}

/**
 * The DNS card of a host window's Details tab: one line per name of the form with the host's last check (state,
 * addresses, how it was found, the time), a Check button, and Keep updated beside a name that a credential could keep
 * updated. The check reads the saved host: a new host says to save first, and a change of the names is noted until the
 * host is saved and checked again. Check works in a View window too (it changes nothing).
 *
 * @param {Object} props
 * @param {"proxy"|"redirection"|"dead"} props.type
 * @param {number} [props.hostId]  the saved host's id; none for a new host
 * @param {(id?: number, prefill?: Object) => void} [props.onKeepUpdated]  opens the record window; without it no
 *        name offers Keep updated
 */
export function HostDnsCard({ type, hostId, onKeepUpdated }) {
	const formNames = useWatch({ name: "domainNames" });
	const { data: checks } = useHostDnsChecks();
	const { mutateAsync: check, isPending } = useCheckHostDns();
	const keep = useKeepUpdated(formNames, Boolean(onKeepUpdated));
	const entry = hostId ? checkOfHost(checks, type, hostId) : undefined;
	const lines = cardLines(formNames, entry?.names);

	const run = async () => {
		try {
			const hosts = await check([{ type, id: hostId }]);
			showSuccess(intl.formatMessage({ id: "dns-check.toast" }, checkCounts(hosts)));
		} catch (err) {
			showApiError(err);
		}
	};

	return (
		<SettingsCard
			id={`dns-card-${type}`}
			className="mb-3"
			lines
			title={<T id="dns-check.title" />}
			info={<T id="dns-check.info" />}
			actions={
				<Button size="sm" onClick={run} isLoading={isPending} disabled={!hostId} data-dns-check-button>
					<Globe data-icon="inline-start" aria-hidden="true" />
					<T id="dns-check.check" />
				</Button>
			}
		>
			{hostId ? (
				<>
					<ul className="m-0 list-none divide-y p-0">
						{lines.map(({ name, result }) => (
							<NameLine
								key={name}
								name={name}
								result={result}
								keepUpdated={keep.get(name.toLowerCase())}
								onKeepUpdated={onKeepUpdated}
							/>
						))}
					</ul>
					{entry ? (
						<p className={NOTE}>
							<T id="dns-check.checked-on" data={{ date: formatDateTime(entry.checkedOn) }} />
							{namesChanged(formNames, entry.names) ? (
								<>
									{" "}
									<T id="dns-check.changed" />
								</>
							) : null}
						</p>
					) : null}
				</>
			) : (
				<p className={NOTE} data-dns-save-first>
					<T id="dns-check.save-first" />
				</p>
			)}
		</SettingsCard>
	);
}
