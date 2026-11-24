import { CircleAlert, CircleCheck, CircleDashed, CirclePause, Clock, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, HasPermission, StatusBadge } from "src/components";
import { useCheckDdnsNow, useDdnsRecords, useDdnsStatus, useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { DDNS_RECORD_LIST_EXPAND } from "src/modules/CertificateTabs";
import { ddnsStatusOf, familiesNeeded, familyLineOf, nextCheckIn, statusErrorItem } from "src/modules/DdnsStatus";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { showApiError } from "src/notifications";
import { ddnsErrorText } from "./errorText";

const BADGES = {
	ok: { tone: "success", icon: CircleCheck },
	waiting: { tone: "info", icon: Clock },
	failed: { tone: "destructive", icon: CircleAlert },
	paused: { tone: "warning", icon: CirclePause },
	none: { tone: "muted", icon: CircleDashed },
};

function AddressLine({ label, family, needed }) {
	const line = familyLineOf(family, needed);
	const texts = {
		failed: ddnsErrorText(family),
		unchecked: intl.formatMessage({ id: "ddns.status.family-unchecked" }, { family: label }),
		unknown: intl.formatMessage({ id: "ddns.status.ipv4-unknown" }),
	};
	return (
		<div className="flex flex-wrap items-baseline gap-x-2">
			<span className="text-muted-foreground">{label}</span>
			{line === "address" ? (
				<span className="font-mono">{family.address}</span>
			) : (
				<span className={line === "failed" ? "text-destructive" : "text-muted-foreground"}>{texts[line]}</span>
			)}
		</div>
	);
}

/** The Public IP card of the Dynamic DNS tab: the state, both addresses, the next check and its buttons */
export function StatusCard() {
	const { data: status } = useDdnsStatus();
	const { data: records } = useDdnsRecords(DDNS_RECORD_LIST_EXPAND);
	const isAdmin = useIsAdmin();
	const navigate = useNavigate();
	const check = useCheckDdnsNow();
	const [showDetails, setShowDetails] = useState(false);
	if (!status) return null;

	const needed = familiesNeeded(records);
	// until the list is loaded both families count
	const state = ddnsStatusOf(status, records ? needed : undefined);
	const { tone, icon: Icon } = BADGES[state];
	const errorText = ddnsErrorText(statusErrorItem(status, records ? needed : undefined));
	const next = nextCheckIn(status.nextRunOn, Date.now());
	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-card p-4" data-ddns-status={state}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<h2 className="m-0 text-base font-semibold">
						<T id="ddns.status.title" />
					</h2>
					<StatusBadge tone={tone} dot={false}>
						<Icon className="size-3.5" aria-hidden="true" />
						<T id={`ddns.status.${state}`} />
					</StatusBadge>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
						<Button
							size="sm"
							isLoading={check.isPending}
							disabled={check.isPending || status.paused || state === "none"}
							onClick={() => check.mutate(undefined, { onError: showApiError })}
						>
							{check.isPending ? null : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
							<T id="ddns.status.check-now" />
						</Button>
					</HasPermission>
					{isAdmin ? (
						<Button size="sm" onClick={() => navigate("/settings/dynamic-dns")}>
							<Settings data-icon="inline-start" aria-hidden="true" />
							<T id="ddns.status.settings" />
						</Button>
					) : null}
				</div>
			</div>
			<div className="flex flex-col gap-1 text-sm">
				<AddressLine label="IPv4" family={status.ipv4} needed={needed.ipv4} />
				<AddressLine label="IPv6" family={status.ipv6} needed={needed.ipv6} />
				{state === "paused" ? (
					<p className="m-0 text-muted-foreground">
						<T id="ddns.status.paused-text" />
					</p>
				) : null}
				{state === "none" ? (
					<p className="m-0 text-muted-foreground">
						<T id="ddns.status.none-text" />
					</p>
				) : null}
				{next && state !== "none" && state !== "paused" ? (
					<p className="m-0 text-muted-foreground">
						<T
							id="ddns.status.next-check"
							data={{ when: intl.formatRelativeTime(next.value, next.unit) }}
						/>
					</p>
				) : null}
			</div>
			{state === "failed" && errorText ? (
				<div className="text-sm">
					<Button
						type="button"
						variant="link"
						className="h-auto p-0"
						aria-expanded={showDetails}
						onClick={() => setShowDetails(!showDetails)}
					>
						<T id={showDetails ? "error.details.hide" : "error.details.show"} />
					</Button>
					{showDetails ? <p className="mt-1 mb-0 wrap-anywhere">{errorText}</p> : null}
				</div>
			) : null}
		</div>
	);
}
