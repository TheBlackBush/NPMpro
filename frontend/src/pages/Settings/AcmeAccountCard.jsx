import { ChevronDown, CircleCheck, CircleDashed, CircleX, Clock, Ellipsis, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, ErrorAlert, Loading, StatusBadge } from "src/components";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "src/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { useAcmeSettings, useRegisterAcmeAccount } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { showAcmeConnectModal, showReplaceAcmeAccountModal } from "src/modals";
import { accountOf, acmeServerLabel, acmeState, cardButtons, connectOutcome } from "src/modules/AcmeAccount";
import { showApiError, showSuccess, showWarning } from "src/notifications";
import { SettingsCard } from "./SettingsCard";

const t = (id, values) => intl.formatMessage({ id }, values);

const caName = (server) => {
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? t(labelId) : text;
};

const formatDate = (value) => (value ? intl.formatDate(value, { dateStyle: "medium" }) : "");

// the badge of each state: tone and icon
const BADGES = {
	registered: { tone: "success", icon: CircleCheck, id: "settings.certificates.acme.status.connected" },
	pending: { tone: "warning", icon: Clock, id: "settings.certificates.acme.status.waiting" },
	failed: { tone: "destructive", icon: CircleX, id: "settings.certificates.acme.status.failed" },
	none: { tone: "muted", icon: CircleDashed, id: "settings.certificates.acme.status.none" },
};

/** The CA's own message in a muted box, collapsed to one line with Show details / Hide details */
function CaMessage({ message }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1 text-muted-foreground">
					{open ? null : <p className="m-0 truncate">{message}</p>}
					<CollapsibleContent>
						<p className="m-0 break-words">{message}</p>
					</CollapsibleContent>
				</div>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="inline-flex shrink-0 items-center gap-1 rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
					>
						<T
							id={
								open
									? "settings.certificates.acme.details.hide"
									: "settings.certificates.acme.details.show"
							}
						/>
						<ChevronDown
							aria-hidden="true"
							className={cn("size-3 transition-transform", open && "rotate-180")}
						/>
					</button>
				</CollapsibleTrigger>
			</div>
		</Collapsible>
	);
}

function Details({ state }) {
	if (state.kind === "registered") {
		return (
			<p className="m-0 text-sm text-muted-foreground">
				<T id="settings.certificates.acme.state.registered" data={{ date: formatDate(state.date) }} />
				<span aria-hidden="true" className="mx-1.5">
					·
				</span>
				{state.email ? state.email : <T id="settings.certificates.acme.state.email-none" />}
			</p>
		);
	}
	if (state.kind === "pending") {
		return (
			<p className="m-0 text-sm text-muted-foreground">
				<T id="settings.certificates.acme.waiting" />
			</p>
		);
	}
	if (state.kind === "failed") {
		return (
			<>
				<p className="m-0 text-sm text-muted-foreground">
					<T id="settings.certificates.acme.state.failed" data={{ date: formatDate(state.date) }} />
				</p>
				{state.error ? <CaMessage message={state.error} /> : null}
			</>
		);
	}
	return (
		<p className="m-0 text-sm text-muted-foreground">
			<T id="settings.certificates.acme.none" />
		</p>
	);
}

function AcmeStatus({ data }) {
	const { mutate: register, isPending } = useRegisterAcmeAccount();
	const account = accountOf(data, data.server);
	const state = acmeState(account);
	const badge = BADGES[state.kind];
	const BadgeIcon = badge.icon;
	const ca = caName(data.server);

	// the answer shows at once: the mutation refetches the account whatever came of it
	const onRetry = () =>
		register(data.server, {
			onSuccess: (result) => {
				if (connectOutcome(result) === "waiting") showWarning(t("settings.certificates.acme.unreachable"));
				else showSuccess(t("settings.certificates.acme.toast.connected", { ca }));
			},
			onError: showApiError,
		});
	const onChange = () => showAcmeConnectModal({ data });

	const actions = {
		change: { id: "settings.certificates.acme.change", onClick: onChange },
		connect: { id: "settings.certificates.acme.connect", onClick: onChange },
		retry: { id: "settings.certificates.acme.retry", onClick: onRetry, loading: isPending },
	};

	return (
		<div
			className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between md:gap-6"
			data-acme-state={state.kind}
		>
			<div className="min-w-0 flex-1">
				<div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
					<StatusBadge tone={badge.tone} dot={false} data-acme-badge>
						<BadgeIcon aria-hidden="true" className="size-3" />
						<T id={badge.id} />
					</StatusBadge>
					<span className="min-w-0 font-medium wrap-anywhere">{ca}</span>
				</div>
				<Details state={state} />
			</div>
			<div className="flex shrink-0 items-center gap-2 max-md:w-full max-md:[&>button]:flex-1">
				{cardButtons(state.kind).map(({ key, primary }) => (
					<Button
						key={key}
						color={primary ? "primary" : "secondary"}
						outline={!primary}
						data-acme-action={key}
						isLoading={actions[key].loading}
						disabled={actions[key].loading}
						onClick={actions[key].onClick}
					>
						{key === "retry" ? <RefreshCw aria-hidden="true" className="size-4" /> : null}
						<T id={actions[key].id} />
					</Button>
				))}
				{state.kind === "registered" ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="max-md:flex-none"
								data-acme-action="more"
								aria-label={t("settings.certificates.acme.more")}
							>
								<Ellipsis aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								data-acme-action="replace"
								onSelect={() => showReplaceAcmeAccountModal({ server: data.server, account, data })}
							>
								<RefreshCw aria-hidden="true" />
								<T id="settings.certificates.acme.replace" />
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
		</div>
	);
}

/**
 * The ACME account card of Settings, Certificates: the instance CA's account as a connection (status, CA, details)
 * with Change, Try again or Connect and a menu holding Replace account. The values change in the Connect window.
 */
export default function AcmeAccountCard() {
	const { data, isPending, error } = useAcmeSettings();
	if (error) return <ErrorAlert error={error} />;
	if (isPending) return <Loading noLogo />;
	return (
		<div data-acme-card>
			<SettingsCard
				id="acme-account-card"
				title={<T id="settings.certificates.acme" />}
				info={<T id="settings.certificates.acme.info" />}
				lines
			>
				<AcmeStatus data={data} />
			</SettingsCard>
		</div>
	);
}
