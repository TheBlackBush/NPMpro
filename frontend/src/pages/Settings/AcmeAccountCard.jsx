import { ChevronDown, CircleCheck, CircleDashed, CircleX, Clock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, ErrorAlert, Loading, StatusBadge } from "src/components";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "src/components/ui/collapsible";
import { useAcmeSettings, useDeleteAcmeAccount, useRegisterAcmeAccount } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { showAcmeConnectModal, showDeleteConfirmModal, showReplaceAcmeAccountModal } from "src/modals";
import {
	acmeServerLabel,
	acmeState,
	cardButtonKey,
	cardButtons,
	connectOutcome,
	messageIsCut,
	otherAccounts,
} from "src/modules/AcmeAccount";
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
	const cut = messageIsCut(message);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1 text-muted-foreground">
					{open ? null : <p className={cn("m-0", cut ? "truncate" : "break-words")}>{message}</p>}
					<CollapsibleContent>
						<p className="m-0 break-words">{message}</p>
					</CollapsibleContent>
				</div>
				{cut ? (
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
				) : null}
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

/**
 * One connection: the status badge, the CA, the details line and the buttons of its state (actions: the handlers of
 * change, connect, retry and replace); trailing is an extra control after the buttons (Remove)
 */
function AccountRow({ state, ca, actions, trailing, ...rest }) {
	const badge = BADGES[state.kind];
	const BadgeIcon = badge.icon;
	return (
		<div
			className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between md:gap-6"
			data-acme-state={state.kind}
			{...rest}
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
			<div className="flex shrink-0 items-center gap-2 max-md:w-full max-md:[&>button:not([data-acme-action=remove])]:flex-1">
				{cardButtons(state.kind).map(({ key, primary }) => (
					<Button
						key={cardButtonKey(key)}
						color={primary ? "primary" : "secondary"}
						outline={!primary}
						data-acme-action={key}
						aria-label={actions[key].label}
						isLoading={actions[key].loading}
						disabled={actions[key].loading}
						onClick={actions[key].onClick}
					>
						{key === "retry" ? <RefreshCw aria-hidden="true" className="size-4" /> : null}
						<T id={actions[key].id} />
					</Button>
				))}
				{/* the instance row keeps the Remove slot, so the buttons of every row end at the same x */}
				{trailing ?? <span aria-hidden="true" className="size-8 shrink-0 max-md:hidden" />}
			</div>
		</div>
	);
}

function AcmeStatus({ data }) {
	const { mutate: register, isPending } = useRegisterAcmeAccount();
	// the backend matched the instance CA's account in any spelling (sameServer)
	const account = data.account ?? null;
	const state = acmeState(account);
	const ca = caName(data.server);

	// the answer shows at once: the mutation refetches the account whatever came of it. No server is sent: the backend
	// takes the instance CA, also an ACME_SERVER the request schema of a typed URL would refuse
	const onRetry = () =>
		register(undefined, {
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
		replace: {
			id: "settings.certificates.acme.replace",
			onClick: () => showReplaceAcmeAccountModal({ server: data.server, account, data }),
		},
	};

	return <AccountRow state={state} ca={ca} actions={actions} />;
}

/** The row of another CA's account: the same layout, its own handlers, and Remove */
function OtherAccountRow({ data, account }) {
	const { mutate: register, isPending } = useRegisterAcmeAccount();
	const { mutateAsync: remove } = useDeleteAcmeAccount();
	const state = acmeState(account);
	const ca = caName(account.server);

	const onRetry = () =>
		register(account.server, {
			onSuccess: (result) => {
				if (connectOutcome(result) === "waiting") showWarning(t("settings.certificates.acme.unreachable"));
				else showSuccess(t("settings.certificates.acme.toast.connected", { ca }));
			},
			onError: showApiError,
		});
	const onChange = () => showAcmeConnectModal({ data, account });
	const label = (id) => t(id, { ca });
	const onRemove = () =>
		showDeleteConfirmModal({
			title: t("settings.certificates.acme.other.remove.title", { ca }),
			children: <T id="settings.certificates.acme.other.remove.text" />,
			confirmLabel: <T id="settings.certificates.acme.other.remove.confirm" />,
			onConfirm: async () => {
				await remove(account.id);
				showSuccess(t("settings.certificates.acme.other.remove.done", { ca }));
				// the row and its button are gone: the focus goes to Add a CA once the window has closed
				setTimeout(() => document.querySelector("[data-acme-action=add]")?.focus(), 150);
			},
			invalidations: [],
		});

	const actions = {
		change: {
			id: "settings.certificates.acme.change",
			label: label("settings.certificates.acme.other.change.label"),
			onClick: onChange,
		},
		retry: {
			id: "settings.certificates.acme.retry",
			label: label("settings.certificates.acme.other.retry.label"),
			onClick: onRetry,
			loading: isPending,
		},
		replace: {
			id: "settings.certificates.acme.replace",
			label: label("settings.certificates.acme.other.replace.label"),
			// the instance rules (ACME_EMAIL) do not apply to another CA: no settings go in
			onClick: () => showReplaceAcmeAccountModal({ server: account.server, account }),
		},
	};

	return (
		<AccountRow
			state={state}
			ca={ca}
			actions={actions}
			data-acme-other={account.server}
			trailing={
				<Button
					variant="ghost"
					size="icon"
					className="size-10 md:size-8"
					data-acme-action="remove"
					aria-label={t("settings.certificates.acme.other.remove.label", { ca })}
					onClick={onRemove}
				>
					<Trash2 aria-hidden="true" className="size-4" />
				</Button>
			}
		/>
	);
}

/** Under the instance CA: the other CAs with an account, and Add a CA */
function OtherCas({ data }) {
	const others = otherAccounts(data, caName);
	return (
		<div className="border-t" data-acme-others>
			<div className="flex items-center justify-between gap-3 px-4 py-3">
				<h3 className="m-0 font-medium text-sm">
					<T id="settings.certificates.acme.other" />
				</h3>
				<Button
					size="sm"
					color="secondary"
					outline
					data-acme-action="add"
					onClick={() => showAcmeConnectModal({ data, mode: "add" })}
				>
					<Plus aria-hidden="true" className="size-4" />
					<T id="settings.certificates.acme.other.add" />
				</Button>
			</div>
			{others.length === 0 ? (
				<p className="m-0 px-4 pb-3 text-muted-foreground text-sm" data-acme-others-empty>
					<T id="settings.certificates.acme.other.empty" />
				</p>
			) : (
				<div className="divide-y border-t">
					{others.map((account) => (
						<OtherAccountRow key={account.id} data={data} account={account} />
					))}
				</div>
			)}
		</div>
	);
}

/**
 * The ACME account card of Settings, Certificates: the instance CA's account as a connection (status, CA, details)
 * with Change, Try again or Connect, and Replace account for a registered account, then the other CAs with an account
 * and Add a CA. The values change in the Connect window.
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
				<OtherCas data={data} />
			</SettingsCard>
		</div>
	);
}
