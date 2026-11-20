import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import {
	Button,
	ErrorAlert,
	HookForm,
	Loading,
	PasswordField,
	SelectField,
	SettingLine,
	SettingLineNote,
	TextField,
	useAppForm,
} from "src/components";
import { LeaveGuard, useAcmeProfiles, useAcmeSettings, useRegisterAcmeAccount, useSaveAcmeSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal, showReplaceAcmeAccountModal } from "src/modals";
import {
	ACME_PRESETS,
	accountOf,
	acmeFormValidate,
	acmePayload,
	acmeServerLabel,
	acmeState,
	CUSTOM,
	canRegisterNow,
	eabLockEnv,
	eabShown,
	lockedSet,
	saveFailureOf,
	serverOfForm,
	toAcmeForm,
} from "src/modules/AcmeAccount";
import { formatApiError } from "src/modules/ApiError";
import { validations } from "src/modules/Validations";
import { showApiError, showError, showObjectSuccess, showSuccess, showWarning } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { SettingsCard } from "./SettingsCard";

const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);
const t = (id, values) => intl.formatMessage({ id }, values);

const caName = (server) => {
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? t(labelId) : text;
};

/** The message of a failed save and the field it belongs to (null for a general one) */
const saveFailure = (err) =>
	saveFailureOf(err?.payload?.error?.message, formatApiError(err, hasMessage, formatMessage).message);

const formatDate = (value) => (value ? intl.formatDate(value, { dateStyle: "medium" }) : "");

function AccountState({ state }) {
	const date = formatDate(state.date);
	let main;
	if (state.kind === "registered") {
		main = (
			<>
				<span className="block">
					<T id="settings.certificates.acme.state.registered" data={{ date }} />
				</span>
				<span className="block">
					{state.email ? (
						<T id="settings.certificates.acme.state.email" data={{ email: state.email }} />
					) : (
						<T id="settings.certificates.acme.state.email-none" />
					)}
				</span>
			</>
		);
	} else if (state.kind === "pending") {
		main = <T id="settings.certificates.acme.state.pending" />;
	} else if (state.kind === "failed") {
		main = <T id="settings.certificates.acme.state.failed" data={{ date }} />;
	} else {
		main = <T id="settings.certificates.acme.state.none" />;
	}
	return (
		<>
			{main}
			{state.error ? (
				<span className="mt-0.5 block text-[0.8rem] break-words text-muted-foreground">{state.error}</span>
			) : null}
		</>
	);
}

/**
 * The line that shows the account of the chosen CA with its Register now or Replace account button
 */
function AccountLine({ data, server }) {
	const { mutate: register, isPending } = useRegisterAcmeAccount();
	const account = accountOf(data, server);
	const state = acmeState(account);
	// a CA without an account row can only register when it is the saved instance CA
	const canRegister = server !== "" && (account !== null || server === data.server);
	const onRegister = () =>
		register(server, {
			onSuccess: (result) => {
				if (result?.warning === "unreachable") showWarning(t("settings.certificates.acme.unreachable"));
				else showSuccess(t("settings.certificates.acme.registered"));
			},
			onError: showApiError,
		});
	let action = null;
	if (state.kind === "registered") {
		action = (
			<Button
				outline
				color="secondary"
				id="acme-replace"
				onClick={() => showReplaceAcmeAccountModal({ server, account })}
			>
				<T id="settings.certificates.acme.replace" />
			</Button>
		);
	} else if (canRegisterNow(account)) {
		action = (
			<Button
				outline
				color="secondary"
				id="acme-register"
				isLoading={isPending}
				disabled={isPending || !canRegister}
				onClick={onRegister}
			>
				<T id="settings.certificates.acme.register" />
			</Button>
		);
	}
	return (
		<SettingLine
			id="acme-account"
			layout="value"
			title={<T id="settings.certificates.acme.account" />}
			control={<AccountState state={state} />}
			aside={action}
			data-acme-state={state.kind}
		/>
	);
}

function AcmeFields({ data, methods, values, locked }) {
	const { setError, trigger } = methods;
	const server = serverOfForm(values);
	const custom = values.preset === CUSTOM;
	const account = accountOf(data, server);

	// the CA's answer about a typed directory URL, asked once it was left (and for the saved custom CA at once)
	const [probeUrl, setProbeUrl] = useState(toAcmeForm(data).customUrl);
	const probed = probeUrl !== "" && probeUrl === server && custom;
	const { data: directory, error: probeError } = useAcmeProfiles(probeUrl, { enabled: probed });
	useEffect(() => {
		if (!(probed && probeError)) return;
		const { message } = formatApiError(probeError, hasMessage, formatMessage);
		setError("customUrl", { type: "server", message });
	}, [probed, probeError, setError]);
	const onUrlBlur = async (event) => {
		const url = event.target.value.trim();
		if (url !== "" && (await trigger("customUrl"))) setProbeUrl(url);
	};

	const showEab = eabShown({
		preset: values.preset,
		externalAccountRequired: probed ? directory?.externalAccountRequired : undefined,
		account,
	});
	const lockedBy = data.lockedBy ?? {};
	const eabLocked = locked.has("eabKid");

	return (
		<>
			<AccountLine data={data} server={server} />
			<SelectField
				line="inline"
				id="acme-ca"
				name="preset"
				label={<T id="settings.certificates.acme.ca" />}
				hint={<T id="settings.certificates.acme.ca.hint" />}
				badges={locked.has("server") ? <LockedBadge env={lockedBy.server} /> : null}
				disabled={locked.has("server")}
			>
				{ACME_PRESETS.map((preset) => (
					<option key={preset.id} value={preset.id}>
						{t(`acme.preset.${preset.id}`)}
					</option>
				))}
				<option value={CUSTOM}>{t("settings.certificates.acme.ca.custom")}</option>
			</SelectField>
			{custom ? (
				<TextField
					line="block"
					id="acme-url"
					name="customUrl"
					type="url"
					label={<T id="settings.certificates.acme.url" />}
					hint={<T id="settings.certificates.acme.url.hint" />}
					badges={locked.has("server") ? <LockedBadge env={lockedBy.server} /> : null}
					placeholder="https://"
					autoComplete="off"
					disabled={locked.has("server")}
					registerOptions={{ onBlur: onUrlBlur }}
				/>
			) : null}
			<TextField
				line="inline"
				id="acme-email"
				name="email"
				type="email"
				label={<T id="settings.certificates.acme.email" />}
				hint={<T id="settings.certificates.acme.email.hint" />}
				badges={locked.has("email") ? <LockedBadge env={lockedBy.email} /> : null}
				autoComplete="off"
				disabled={locked.has("email")}
			/>
			{values.preset === "zerossl" ? (
				<SettingLineNote icon={Info}>
					<T id="settings.certificates.acme.email.zerossl" />
				</SettingLineNote>
			) : null}
			{showEab ? (
				<>
					<TextField
						line="inline"
						id="acme-eab-kid"
						name="eabKid"
						label={<T id="settings.certificates.acme.eab-kid" />}
						hint={<T id="settings.certificates.acme.eab-kid.hint" />}
						badges={eabLocked ? <LockedBadge env={eabLockEnv(lockedBy, "eabKid")} /> : null}
						autoComplete="off"
						disabled={eabLocked}
					/>
					<PasswordField
						line="inline"
						id="acme-eab-hmac"
						name="eabHmacKey"
						label={<T id="settings.certificates.acme.eab-hmac" />}
						hint={
							data.eabHmacKeySet ? (
								<T id="settings.certificates.acme.eab-hmac.saved" />
							) : (
								<T id="settings.certificates.acme.eab-hmac.hint" />
							)
						}
						badges={eabLocked ? <LockedBadge env={eabLockEnv(lockedBy, "eabHmacKey")} /> : null}
						autoComplete="new-password"
						disabled={eabLocked}
					/>
				</>
			) : null}
		</>
	);
}

function AcmeForm({ data }) {
	const { mutateAsync: save } = useSaveAcmeSettings();
	const [failure, setFailure] = useState(null);
	const locked = lockedSet(data.locked);
	const saved = toAcmeForm(data);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		validate: acmeFormValidate(validations, data),
	});
	const values = useWatch({ control: methods.control });
	const payload = acmePayload({ ...saved, ...values }, data);
	const { isSubmitting } = methods.formState;

	const doSave = async (body) => {
		setFailure(null);
		try {
			const result = await save(body);
			showObjectSuccess("setting", "saved");
			if (result?.warning === "unreachable") showWarning(t("settings.certificates.acme.unreachable"));
		} catch (err) {
			const { message, field } = saveFailure(err);
			if (field) {
				methods.setError(field, { type: "server", message });
				showError(message);
			} else {
				setFailure(message);
				showApiError(err);
			}
		}
	};

	const onSubmit = async (formValues) => {
		const body = acmePayload(formValues, data);
		if (Object.keys(body).length === 0) return;
		if (!body.server) {
			await doSave(body);
			return;
		}
		// the question never throws: doSave reports its own failure in the card
		showDeleteConfirmModal({
			tTitle: "settings.certificates.acme.change-ca.title",
			confirmLabel: t("settings.certificates.acme.change-ca.confirm"),
			confirmVariant: "default",
			invalidations: [],
			onConfirm: () => doSave(body),
			children: (
				<T
					id="settings.certificates.acme.change-ca.text"
					data={{ new: caName(body.server), old: caName(data.server) }}
				/>
			),
		});
	};

	return (
		<div data-acme-card>
			<HookForm methods={methods} onSubmit={onSubmit}>
				<LeaveGuard />
				<SettingsCard
					id="acme-account-card"
					title={<T id="settings.certificates.acme" />}
					info={<T id="settings.certificates.acme.info" />}
					lines
					actions={
						<Button
							color="primary"
							type="submit"
							isLoading={isSubmitting}
							disabled={isSubmitting || Object.keys(payload).length === 0}
						>
							<T id="save" />
						</Button>
					}
				>
					{failure ? (
						<SettingLineNote>
							<ErrorAlert onClose={() => setFailure(null)}>{failure}</ErrorAlert>
						</SettingLineNote>
					) : null}
					<AcmeFields data={data} methods={methods} values={{ ...saved, ...values }} locked={locked} />
				</SettingsCard>
			</HookForm>
		</div>
	);
}

/**
 * The ACME account card of Settings, Certificates: the CA, its account and the email and EAB keys, with its own Save
 * (a save registers the account, so it is not part of the section's Save bar). Replace account opens its window.
 */
export default function AcmeAccountCard() {
	const { data, isPending, error } = useAcmeSettings();
	if (error) return <ErrorAlert error={error} />;
	if (isPending) return <Loading noLogo />;
	return <AcmeForm data={data} />;
}
