import { useEffect, useRef, useState } from "react";
import { get, useFormContext, useFormState, useWatch } from "react-hook-form";
import { Button } from "src/components/Button";
import { StatusBadge } from "src/components/StatusBadge";
import { Checkbox } from "src/components/ui/checkbox";
import { useCanManage, useHostDnsPlan, useHostDnsRecordAction, useHostDnsRecords, useProbeHostReach } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import {
	deletesOnSave,
	hasOrphans,
	nameRow,
	reachBlocked,
	reachPending,
	reachText,
	refusedTicks,
	ticksOf,
	withChange,
	withoutTick,
	withTick,
} from "src/modules/HostDnsRecords";
import { CERTIFICATES } from "src/modules/Permissions";
import { showApiError, showSuccess, showWarning } from "src/notifications";
import { useReadOnly } from "./HookForm";
import { SwitchField } from "./SwitchField";

const HOST_TYPE_IDS = { proxy: "proxy_host", redirection: "redirection_host", dead: "dead_host" };
const NONE = [];
const NOTE = "text-sm text-muted-foreground";
const CLOCK_MS = 30 * 1000;
const FOCUS_FRAMES = 10;

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

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * After a host save: a warning that names each ticked name the answer refused or failed, with its reason (the window
 * may close; the card shows the state when the host is opened again). Nothing when every ticked name was taken.
 *
 * @param {Array<{ name: string }>|undefined} wanted  the request's npmproDnsRecords
 * @param {Array<Object>|undefined} states  the answer's npmproDnsRecords
 */
export function showRefusedTicks(wanted, states) {
	const refused = refusedTicks(wanted, states);
	if (refused.length === 0) return;
	showWarning(
		<ul className="m-0 list-none p-0" data-dns-refused>
			{refused.map(({ name, id, detail }) => (
				<li key={name}>
					{intl.formatMessage(
						{ id: "host-dns.refused" },
						{ name, reason: id ? intl.formatMessage({ id }) : (detail ?? "") },
					)}
				</li>
			))}
		</ul>,
	);
}

// the text of a probe: checking, its answer, or that it could not run; null before a probe
function ProbeText({ probe }) {
	if (probe?.status === "checking") {
		return (
			<T id={probe.address ? "host-dns.checking" : "host-dns.checking-plain"} data={{ address: probe.address }} />
		);
	}
	if (probe?.status === "failed") {
		return (
			<span data-dns-reach="failed">
				<T id="host-dns.reach.failed" />
			</span>
		);
	}
	const text = probe?.result ? reachText(probe.result) : null;
	return text ? (
		<span data-dns-reach={probe.result.result}>
			<T id={text.id} data={text.values} />
		</span>
	) : null;
}

// one ticked name: the box for the user's own confirmation, what Save will create and the options
function TickDetails({ index, entry, row, reach, now, error, onChange, disabled }) {
	// no valid reach at the server (still checking, not reachable, or the answer is older than it remembers): the
	// user confirms
	const confirm = Boolean(reach) && reachPending({ reach }, now);
	const errorId = `dns-reach-${index}-error`;
	return (
		<div className="flex flex-col gap-2 pl-7">
			{confirm ? (
				<div className="flex flex-col gap-1 text-sm">
					<div className="flex items-start gap-2">
						<Checkbox
							id={`dns-reach-${index}`}
							checked={entry.reachConfirmed === true}
							disabled={disabled}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? errorId : undefined}
							onCheckedChange={(checked) => onChange({ ...entry, reachConfirmed: checked === true })}
						/>
						<label htmlFor={`dns-reach-${index}`}>
							<T id="host-dns.reach-confirm" />
						</label>
					</div>
					{error ? (
						<p id={errorId} className="pl-6 text-sm text-destructive" data-dns-reach-error>
							{error}
						</p>
					) : null}
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

// the plan while it loads (a polite region that is always there) and when it failed, with Try again
function PlanState({ loading, failed, retry }) {
	if (failed) {
		return (
			<div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm" data-dns-plan-failed>
				<span className="text-destructive" role="alert">
					<T id="host-dns.plan-failed" />
				</span>
				<Button type="button" variant="outline" size="xs" onClick={retry}>
					<T id="host-dns.plan-retry" />
				</Button>
			</div>
		);
	}
	return (
		<p className={`${NOTE} px-4 py-2 empty:py-0`} aria-live="polite" data-dns-plan-loading={loading || undefined}>
			{loading ? <T id="host-dns.plan-loading" /> : null}
		</p>
	);
}

/**
 * The host record option of the DNS card: the switch "Create DNS records for this host" (off by default) and, when it
 * is on, one line per name of the form with a box, the state of its record, the options of a new record and the
 * buttons of an existing one, then the rows of names the host no longer has whose delete at the provider failed. The
 * form field npmproDnsRecords holds the ticks once the user touched the card (modules/HostDnsRecords.js wantedFromForm
 * sends them); a save writes at the provider after the host is saved. A ticked name whose probe did not show this
 * server reachable refuses the save until its box "I checked from outside" is ticked.
 *
 * @param {Object} props
 * @param {"proxy"|"redirection"|"dead"} props.type
 * @param {number} [props.hostId]  the saved host's id; none for a new host
 */
export function HostDnsRecords({ type, hostId: savedId }) {
	// a new host's window holds the id 0: no saved host
	const hostId = savedId || undefined;
	const { setValue, getValues, unregister } = useFormContext();
	const { errors, isSubmitted, submitCount } = useFormState();
	const readOnly = useReadOnly();
	const canManage = useCanManage(CERTIFICATES);
	const [names, entries] = useWatch({ name: ["domainNames", "npmproDnsRecords"] });
	const formNames = Array.isArray(names) ? names : NONE;
	const { data: host } = useHostDnsRecords(type, hostId);
	const records = host?.npmproDnsRecords ?? NONE;
	const { mutateAsync: probeReach } = useProbeHostReach();
	const { mutateAsync: runAction } = useHostDnsRecordAction(type, hostId);
	// the probes of this window by lower case name: { status, result, address, at }
	const [probes, setProbes] = useState({});
	const [switched, setSwitched] = useState(null);
	// what the field held when the switch was turned off: undefined for a card the user had not touched
	const beforeOff = useRef(undefined);

	const ticks = entries ?? ticksOf(records, formNames);
	// a host with rows opens with them shown, an orphan's too (its line offers the delete at the provider again)
	const on = switched ?? (ticks.length > 0 || hasOrphans(records));
	const rights = { canTick: canManage, readOnly };
	const unique = [...new Map(formNames.map((name) => [name.toLowerCase(), name])).values()];
	const planQuery = useHostDnsPlan(type, hostId, unique, on);
	const plan = planQuery.data;
	const planFor = (name) => plan?.names?.find((one) => sameName(one.name, name));
	const hostNames = (host?.domainNames ?? NONE).map((name) => name.toLowerCase());
	// orphans of names the host no longer has: shown below its names, with their delete at the provider again
	const leftOver = records.filter(
		(record) => record.state === "orphan" && !unique.some((name) => sameName(name, record.name)),
	);
	// the clock moves on while a reachable answer is shown, so the confirmation box returns when the server forgets it
	const [now, setNow] = useState(() => Date.now());
	const watching = Object.values(probes).some((probe) => probe.result?.result === "reachable");
	useEffect(() => {
		if (!watching) return;
		const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
		return () => clearInterval(timer);
	}, [watching]);

	// the message on a ticked name's confirmation box after a refused save, by its place in the field
	const errorAt = (name) => {
		const position = Array.isArray(entries) ? entries.findIndex((one) => sameName(one.name, name)) : -1;
		return position < 0 ? null : (get(errors, `npmproDnsRecords.${position}.reachConfirmed`)?.message ?? null);
	};
	// a save refused only for these boxes moves the focus to the first one (the field has no input of its own, and it
	// comes last in the form's order); its tab may open first, so the box is waited for a few frames
	const onlyHere = Object.keys(errors).every((key) => key === "npmproDnsRecords");
	const firstError = onlyHere ? unique.findIndex((name) => errorAt(name) !== null) : -1;
	useEffect(() => {
		if (submitCount === 0 || firstError < 0) return;
		let frames = 0;
		let handle = null;
		const focus = () => {
			const box = document.querySelector(`#dns-reach-${firstError}`);
			if (box?.offsetParent) box.focus();
			else if (frames < FOCUS_FRAMES) {
				frames += 1;
				handle = requestAnimationFrame(focus);
			}
		};
		focus();
		return () => cancelAnimationFrame(handle);
	}, [submitCount, firstError]);

	// the ticks as the form holds them now (an answer that comes later must not use the ticks of its click)
	const latest = () => getValues("npmproDnsRecords") ?? ticksOf(records, getValues("domainNames") ?? NONE);
	// after a refused save the messages follow each change
	const store = (next) => setValue("npmproDnsRecords", next, { shouldDirty: true, shouldValidate: isSubmitted });
	const setProbe = (name, value) => setProbes((current) => ({ ...current, [name.toLowerCase()]: value }));

	const turnOn = (value) => {
		setSwitched(value);
		if (!value) {
			beforeOff.current = getValues("npmproDnsRecords");
			store([]);
			return;
		}
		// back on: an untouched card is untouched again (the field leaves the form, as before the first touch), else the
		// names start ticked as the host has them
		if (beforeOff.current === undefined) unregister("npmproDnsRecords");
		else store(ticksOf(records, getValues("domainNames") ?? NONE));
	};

	// the probe's state goes into the tick too (validate reads it), except for an orphan's name: its row resumes
	const markReach = (name, reach) => {
		if (records.some((record) => record.state === "orphan" && sameName(record.name, name))) return;
		const entry = latest().find((one) => sameName(one.name, name));
		if (entry) store(withChange(latest(), { ...entry, reach }));
	};

	const tick = async (name) => {
		store(withTick(latest(), name));
		const checking = { status: "checking", address: plan?.address ?? null };
		setProbe(name, checking);
		markReach(name, checking);
		try {
			const result = await probeReach({
				hostType: HOST_TYPE_IDS[type],
				hostId: hostId && hostNames.includes(name.toLowerCase()) ? hostId : undefined,
				name,
			});
			const done = { status: "done", result, address: result.address, at: Date.now() };
			setProbe(name, done);
			setNow(Date.now());
			if (reachBlocked(result)) store(withoutTick(latest(), name));
			else markReach(name, done);
		} catch {
			const failed = { status: "failed", at: Date.now() };
			setProbe(name, failed);
			markReach(name, failed);
		}
	};
	const untick = (name) => store(withoutTick(latest(), name));
	const change = (next) => store(withChange(latest(), next));

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
				let answer;
				try {
					answer = await runAction({ action, id: record.recordId });
				} catch (err) {
					showApiError(err);
					throw err;
				}
				// a provider that still refuses keeps the row an orphan: say so, the line shows the new error
				if (action === "remove" && answer?.state === "orphan") {
					showWarning(
						answer.message ?? intl.formatMessage({ id: "ddns.orphan.still" }, { name: record.name }),
					);
					return;
				}
				// the row is gone at the server; only a card the user changed holds the name to drop
				if (action === "leave" && getValues("npmproDnsRecords") !== undefined) untick(record.name);
				showSuccess(intl.formatMessage({ id: spec.doneId }, { name: record.name }));
			},
		});
	};

	const actionButtons = (row, record, name) =>
		row.actions.map((action) => (
			<Button
				key={action}
				type="button"
				variant={action === "adopt" ? "default" : "outline"}
				size="xs"
				data-dns-record-action={action}
				aria-label={intl.formatMessage(
					{ id: "host-dns.action-label" },
					{ action: intl.formatMessage({ id: ACTIONS[action].titleId }), name },
				)}
				onClick={() => ask(action, record)}
			>
				<T id={ACTIONS[action].titleId} />
			</Button>
		));

	const stateBadge = (row, record) =>
		row.line ? (
			<>
				<StatusBadge tone={row.line.tone} data-dns-record-state={record?.state}>
					<T id={row.line.id} data={row.line.values} />
				</StatusBadge>
				{row.line.detail ? (
					<span className="text-muted-foreground wrap-anywhere">{row.line.detail}</span>
				) : null}
			</>
		) : null;

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
				<PlanState
					loading={!plan && planQuery.isFetching && !planQuery.isError}
					failed={planQuery.isError}
					retry={() => void planQuery.refetch()}
				/>
			) : null}
			{on ? (
				<ul className="m-0 list-none divide-y border-t p-0" data-dns-records>
					{unique.map((name, index) => {
						const record = records.find((one) => sameName(one.name, name));
						const entry = ticks.find((one) => sameName(one.name, name));
						const row = nameRow(planFor(name), record, {
							...rights,
							ipv6: entry?.ipv6 === true,
							ipv6Address: plan?.ipv6Address ?? null,
							hostDisabled: plan?.hostDisabled === true,
						});
						const probe = probes[name.toLowerCase()];
						const id = `dns-tick-${type}-${index}`;
						const blockedNote = Boolean(row.blocked && !entry && !row.line);
						const existingNote = Boolean(row.existing && !row.line);
						const details = Boolean(entry && !row.managed);
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
										aria-describedby={blockedNote || existingNote ? `${id}-note` : undefined}
										onCheckedChange={(value) => (value === true ? tick(name) : untick(name))}
									/>
									<label htmlFor={id} className="font-mono wrap-anywhere">
										{name}
									</label>
									{stateBadge(row, record)}
									{actionButtons(row, record, name)}
								</div>
								{blockedNote ? (
									<p id={`${id}-note`} className={`${NOTE} pl-7`}>
										<T id={row.blocked.id} data={row.blocked.values} />
										{row.blocked.detail ? `: ${row.blocked.detail}` : null}
									</p>
								) : null}
								{existingNote ? (
									<p id={`${id}-note`} className={`${NOTE} pl-7`} data-dns-existing>
										<T id={row.existing.id} data={row.existing.values} />
									</p>
								) : null}
								{/* one live region per name, there from the start, so each probe text is announced */}
								<p className={`${NOTE} pl-7 empty:-mt-2`} aria-live="polite">
									{details || (probe?.result && reachBlocked(probe.result)) ? (
										<ProbeText probe={probe} />
									) : null}
								</p>
								{details ? (
									<TickDetails
										index={index}
										entry={entry}
										row={row}
										reach={entry.reach ?? probe}
										now={now}
										error={errorAt(name)}
										onChange={change}
										disabled={readOnly}
									/>
								) : null}
							</li>
						);
					})}
					{leftOver.map((record) => {
						const row = nameRow(undefined, record, rights);
						return (
							<li
								key={`orphan-${record.name.toLowerCase()}`}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
								data-dns-record={record.name}
							>
								<span className="pl-7 font-mono wrap-anywhere">{record.name}</span>
								{stateBadge(row, record)}
								{actionButtons(row, record, record.name)}
							</li>
						);
					})}
				</ul>
			) : null}
			{!on && deletesOnSave(records) && !readOnly ? (
				<p className={`${NOTE} border-t px-4 py-3`} data-dns-off-note>
					<T id="host-dns.off-note" />
				</p>
			) : null}
		</>
	);
}
