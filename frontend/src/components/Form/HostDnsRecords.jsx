import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "src/components/Button";
import { StatusBadge } from "src/components/StatusBadge";
import { Checkbox } from "src/components/ui/checkbox";
import {
	useCanManage,
	useDdnsProviders,
	useDnsDomains,
	useHostDnsChecks,
	useHostDnsRecordAction,
	useHostDnsRecords,
	useProbeHostReach,
	useUser,
} from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { checkOfHost } from "src/modules/DnsCheck";
import { nameRow, needsReachConfirm, planOf, reachBlocked, reachText, ticksOf } from "src/modules/HostDnsRecords";
import { CERTIFICATES } from "src/modules/Permissions";
import { showApiError, showSuccess } from "src/notifications";
import { useReadOnly } from "./HookForm";
import { SwitchField } from "./SwitchField";

const HOST_TYPE_IDS = { proxy: "proxy_host", redirection: "redirection_host", dead: "dead_host" };
const NONE = [];
const NOTE = "text-sm text-muted-foreground";
const EXPAND = ["credential"];

// the question of each record action: title, text, button and the toast, written out whole
const ACTIONS = {
	adopt: {
		titleId: "host-dns.adopt",
		textId: "host-dns.adopt.confirm",
		doneId: "host-dns.adopt.done",
		variant: "default",
	},
	leave: {
		titleId: "host-dns.leave",
		textId: "host-dns.leave.confirm",
		doneId: "host-dns.leave.done",
		variant: "default",
	},
	remove: {
		titleId: "host-dns.remove",
		textId: "host-dns.remove.confirm",
		doneId: "host-dns.remove.done",
		variant: "destructive",
	},
};
const ACTION_ICON_LABELS = {
	adopt: "host-dns.adopt.label",
	leave: "host-dns.leave.label",
	remove: "host-dns.remove.label",
};

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// one ticked name: the probe's answer, the box for the user's own confirmation, what Save will create and the options
function TickDetails({ index, entry, row, probe, onChange, disabled }) {
	const confirm = probe && probe.status !== "checking" && needsReachConfirm(probe.result ?? null);
	const text = probe?.result ? reachText(probe.result) : null;
	return (
		<div className="flex flex-col gap-2 pl-7">
			{probe?.status === "checking" ? (
				<p className={NOTE} aria-live="polite">
					<T
						id={probe.address ? "host-dns.checking" : "host-dns.checking-plain"}
						data={{ address: probe.address }}
					/>
				</p>
			) : null}
			{text ? (
				<p className={NOTE} aria-live="polite" data-dns-reach={probe.result.result}>
					<T id={text.id} data={text.values} />
				</p>
			) : null}
			{probe?.status === "failed" ? (
				<p className={NOTE} aria-live="polite" data-dns-reach="failed">
					<T id="host-dns.reach.failed" />
				</p>
			) : null}
			{confirm ? (
				<div className="flex items-start gap-2 text-sm">
					<Checkbox
						id={`dns-reach-${index}`}
						checked={entry.reachConfirmed === true}
						disabled={disabled}
						onCheckedChange={(checked) => onChange({ ...entry, reachConfirmed: checked === true })}
					/>
					<label htmlFor={`dns-reach-${index}`}>
						<T id="host-dns.reach-confirm" />
					</label>
				</div>
			) : null}
			{row.willCreate ? (
				<p className={NOTE} data-dns-will-create>
					<T id={row.willCreate.id} data={row.willCreate.values} />
				</p>
			) : null}
			{row.showProxied ? (
				<div className="flex items-start gap-2 text-sm">
					<Checkbox
						id={`dns-proxied-${index}`}
						checked={entry.proxied === true}
						disabled={disabled}
						onCheckedChange={(checked) => onChange({ ...entry, proxied: checked === true })}
					/>
					<label htmlFor={`dns-proxied-${index}`}>
						<T id="host-dns.proxied" />
					</label>
				</div>
			) : null}
			{row.showIpv6 ? (
				<div className="flex flex-col gap-1 text-sm">
					<div className="flex items-start gap-2">
						<Checkbox
							id={`dns-ipv6-${index}`}
							checked={entry.ipv6 === true}
							disabled={disabled}
							aria-describedby={`dns-ipv6-note-${index}`}
							onCheckedChange={(checked) => onChange({ ...entry, ipv6: checked === true })}
						/>
						<label htmlFor={`dns-ipv6-${index}`}>
							<T id="host-dns.ipv6" />
						</label>
					</div>
					<p id={`dns-ipv6-note-${index}`} className={`${NOTE} pl-6`}>
						<T id="host-dns.ipv6.note" />
					</p>
				</div>
			) : null}
		</div>
	);
}

/**
 * The host record option of the DNS card: the switch "Create DNS records for this host" (off by default) and, when it
 * is on, one line per name of the form with a box, the state of its record, the options of a new record and the
 * buttons of an existing one. The form field npmproDnsRecords holds the ticks once the user touched the card
 * (modules/HostDnsRecords.js wantedFromForm sends them); a save writes at the provider after the host is saved.
 *
 * @param {Object} props
 * @param {"proxy"|"redirection"|"dead"} props.type
 * @param {number} [props.hostId]  the saved host's id; none for a new host
 */
export function HostDnsRecords({ type, hostId }) {
	const { setValue } = useFormContext();
	const readOnly = useReadOnly();
	const canManage = useCanManage(CERTIFICATES);
	const { data: user } = useUser("me");
	const [names, entries] = useWatch({ name: ["domainNames", "npmproDnsRecords"] });
	const formNames = Array.isArray(names) ? names : NONE;
	const { data: host } = useHostDnsRecords(type, hostId);
	const records = host?.npmproDnsRecords ?? NONE;
	const { data: domains } = useDnsDomains(EXPAND, { enabled: canManage });
	const { data: providers } = useDdnsProviders({ enabled: canManage });
	const { data: checks } = useHostDnsChecks();
	const { mutateAsync: probeReach } = useProbeHostReach();
	const { mutateAsync: runAction } = useHostDnsRecordAction(type, hostId);
	// the probes of this window by lower case name: { status, result, address }
	const [probes, setProbes] = useState({});
	const [switched, setSwitched] = useState(null);

	const ticks = entries ?? ticksOf(records, formNames);
	const on = switched ?? ticks.length > 0;
	const checked = hostId ? checkOfHost(checks, type, hostId)?.names?.[0] : undefined;
	const hostNames = (host?.domainNames ?? NONE).map((name) => name.toLowerCase());
	const rights = { canTick: canManage, readOnly };

	const store = (next) => setValue("npmproDnsRecords", next, { shouldDirty: true });
	const setProbe = (name, value) => setProbes((current) => ({ ...current, [name.toLowerCase()]: value }));

	const turnOn = (value) => {
		setSwitched(value);
		if (!value) store([]);
	};

	const tick = async (name) => {
		store([...ticks, { name, proxied: false, ipv6: false, reachConfirmed: false }]);
		setProbe(name, {
			status: "checking",
			address: probes[name.toLowerCase()]?.address ?? checked?.ipv4?.public ?? null,
		});
		try {
			const result = await probeReach({
				hostType: HOST_TYPE_IDS[type],
				hostId: hostId && hostNames.includes(name.toLowerCase()) ? hostId : undefined,
				name,
			});
			setProbe(name, { status: "done", result, address: result.address });
			if (reachBlocked(result)) store(ticks.filter((entry) => !sameName(entry.name, name)));
		} catch {
			setProbe(name, { status: "failed" });
		}
	};
	const untick = (name) => store(ticks.filter((entry) => !sameName(entry.name, name)));
	const change = (next) => store(ticks.map((entry) => (sameName(entry.name, next.name) ? next : entry)));

	const ask = (action, record) => {
		const spec = ACTIONS[action];
		showDeleteConfirmModal({
			title: <T id={spec.titleId} />,
			children: <T id={spec.textId} />,
			subject: record.name,
			confirmLabel: <T id={spec.titleId} />,
			confirmVariant: spec.variant,
			invalidations: [],
			onConfirm: async () => {
				try {
					await runAction({ action, id: record.recordId });
				} catch (err) {
					showApiError(err);
					throw err;
				}
				if (action === "leave") untick(record.name);
				showSuccess(intl.formatMessage({ id: spec.doneId }, { name: record.name }));
			},
		});
	};

	const unique = [...new Map(formNames.map((name) => [name.toLowerCase(), name])).values()];
	const created = records.some((record) => record.origin === "created");
	return (
		<>
			<SwitchField
				line
				id={`dns-records-${type}`}
				label={<T id="host-dns.switch" />}
				hint={<T id="host-dns.switch.hint" />}
				checked={on}
				disabled={readOnly}
				onChange={(event) => turnOn(event.target.checked)}
			/>
			{on ? (
				<ul className="m-0 list-none divide-y border-t p-0" data-dns-records>
					{unique.map((name, index) => {
						const record = records.find((one) => sameName(one.name, name));
						const plan = planOf({
							name,
							domains,
							providers,
							userId: user?.id,
							canManage,
							address: probes[name.toLowerCase()]?.address ?? checked?.ipv4?.public ?? null,
							ipv6Address: checked?.ipv6?.public ?? null,
						});
						const row = nameRow(plan, record, rights);
						const entry = ticks.find((one) => sameName(one.name, name));
						const probe = probes[name.toLowerCase()];
						const id = `dns-tick-${type}-${index}`;
						return (
							<li
								key={name.toLowerCase()}
								className="flex flex-col gap-2 px-4 py-3 text-sm"
								data-dns-record={name}
							>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<Checkbox
										id={id}
										checked={Boolean(entry)}
										disabled={readOnly || !(row.tickable || entry)}
										aria-describedby={row.blocked ? `${id}-note` : undefined}
										onCheckedChange={(value) => (value === true ? tick(name) : untick(name))}
									/>
									<label htmlFor={id} className="font-mono wrap-anywhere">
										{name}
									</label>
									{row.line ? (
										<StatusBadge tone={row.line.tone} data-dns-record-state={record?.state}>
											<T id={row.line.id} data={row.line.values} />
										</StatusBadge>
									) : null}
									{row.line?.detail ? (
										<span className="text-muted-foreground wrap-anywhere">{row.line.detail}</span>
									) : null}
									{row.actions.map((action) => (
										<Button
											key={action}
											type="button"
											variant={action === "adopt" ? "default" : "outline"}
											size="xs"
											data-dns-record-action={action}
											aria-label={intl.formatMessage(
												{ id: ACTION_ICON_LABELS[action] },
												{ name },
											)}
											onClick={() => ask(action, record)}
										>
											<T id={ACTIONS[action].titleId} />
										</Button>
									))}
								</div>
								{row.blocked && !entry && !row.line ? (
									<p id={`${id}-note`} className={`${NOTE} pl-7`}>
										<T id={row.blocked} />
									</p>
								) : null}
								{!entry && probe?.result && reachBlocked(probe.result) ? (
									<p className={`${NOTE} pl-7`} data-dns-reach="no-public-address">
										<T id="error.host-dns-no-public-address" />
									</p>
								) : null}
								{entry && !row.managed ? (
									<TickDetails
										index={index}
										entry={entry}
										row={row}
										probe={probe}
										onChange={change}
										disabled={readOnly}
									/>
								) : null}
							</li>
						);
					})}
				</ul>
			) : null}
			{!on && created && !readOnly ? (
				<p className={`${NOTE} border-t px-4 py-3`} data-dns-off-note>
					<T id="host-dns.off-note" />
				</p>
			) : null}
		</>
	);
}
