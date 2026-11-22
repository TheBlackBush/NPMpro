import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { getAcmeProfiles } from "src/api/backend";
import {
	AppModal,
	Button,
	HookForm,
	PasswordField,
	SelectField,
	SettingLineNote,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import {
	DirtyTracker,
	useAcmeProfiles,
	useAddAcmeAccount,
	useRegisterAcmeAccount,
	useSaveAcmeSettings,
	useUnsavedChangesGuard,
	useUpdateAcmeAccount,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	ACME_PRESETS,
	accountContext,
	accountOf,
	acmeAccountPayload,
	acmeAddValidate,
	acmeFormValidate,
	acmePayload,
	acmeServerLabel,
	addChoices,
	addDefaults,
	CUSTOM,
	connectNeedsCheck,
	connectOutcome,
	connectPlan,
	directoryReachable,
	directoryUnreadable,
	eabLockEnv,
	eabShown,
	emailForCa,
	lockedSet,
	otherPlan,
	presetOf,
	refusalText,
	saveFailureOf,
	serverOfForm,
	serverParam,
	toAcmeForm,
	visibleEabValues,
} from "src/modules/AcmeAccount";
import { formatApiError } from "src/modules/ApiError";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showSuccess } from "src/notifications";
import { LockedBadge } from "src/pages/Settings/Authentication/LockedBadge";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

/**
 * The Connect window. Without options it connects the instance CA; mode "add" adds another CA; account (a stored
 * account of another CA) edits that account, and its CA cannot change.
 */
const showAcmeConnectModal = ({ data, account, mode }) => {
	EasyModal.show(AcmeConnectModal, { data, account, mode });
};

const hasMessage = (id) => Boolean(intl.messages[id]);
const formatMessage = (id, values) => intl.formatMessage({ id }, values);
const t = (id, values) => intl.formatMessage({ id }, values);

const caName = (server) => {
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? t(labelId) : text;
};

/**
 * The message of a failed call and the field it belongs to (null: a general one); eabSent: the call carried an EAB
 * pair. A refusal shows the CA's own sentence, the box title already says it refused.
 */
const failureOf = (err, eabSent) => {
	const apiError = err?.payload?.error;
	const failure = saveFailureOf(apiError?.message, formatApiError(err, hasMessage, formatMessage).message, {
		eabSent,
	});
	return { ...failure, message: refusalText(apiError, failure.message) };
};

function EnvHint({ env }) {
	return <T id="settings.certificates.acme.env-hint" data={{ env }} />;
}

const AcmeConnectModal = EasyModal.create(({ data: settings, account, mode, visible, remove }) => {
	const { mutateAsync: save } = useSaveAcmeSettings();
	const { mutateAsync: register } = useRegisterAcmeAccount();
	const { mutateAsync: addAccount } = useAddAcmeAccount();
	const { mutateAsync: updateAccount } = useUpdateAcmeAccount();
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	// main: the instance CA; add: another CA without an account; edit: the account of another CA
	const kind = mode === "add" ? "add" : account ? "edit" : "main";
	const main = kind === "main";
	const data = main ? settings : accountContext(settings, kind === "edit" ? account : null);
	// null, { kind: "refused", message } or { kind: "unreachable" }
	const [outcome, setOutcome] = useState(null);
	const [eabSwitch, setEabSwitch] = useState(false);
	const saved = kind === "add" ? addDefaults(settings) : toAcmeForm(data);
	const choices = kind === "add" ? addChoices(settings) : [];
	const methods = useAppForm({
		defaultValues: saved,
		validate: kind === "add" ? acmeAddValidate(validations, settings) : acmeFormValidate(validations, data),
	});
	const { isSubmitting } = methods.formState;
	const values = { ...saved, ...useWatch({ control: methods.control }) };
	const server = serverOfForm(values);
	const custom = values.preset === CUSTOM;
	const locked = lockedSet(data.locked);
	const lockedBy = data.lockedBy ?? {};
	const eabLocked = locked.has("eabKid");

	// the CA's answer about a typed directory URL, asked once the field was left (and for the saved custom CA at once)
	const [probeUrl, setProbeUrl] = useState(saved.customUrl);
	const probed = probeUrl !== "" && probeUrl === server && custom;
	const { data: directory, error: probeError } = useAcmeProfiles(probeUrl, { enabled: probed });
	const unreadable = directoryUnreadable({
		custom,
		probed,
		error: probeError,
		result: directory,
		account: accountOf(data, server),
	});
	// the email shown is the one the picked CA's account has (or the env value): what is shown is what Connect applies
	const onPresetChange = (event) => {
		const target = serverOfForm({ preset: event.target.value, customUrl: methods.getValues("customUrl") });
		methods.setValue("email", emailForCa(data, target), { shouldDirty: true });
	};
	const onUrlBlur = async (event) => {
		const url = event.target.value.trim();
		if (url !== "" && (await methods.trigger("customUrl"))) setProbeUrl(url);
	};
	const showEab =
		eabShown({
			preset: values.preset,
			externalAccountRequired:
				probed && directoryReachable(directory) ? directory.externalAccountRequired : undefined,
			account: accountOf(data, server),
		}) ||
		(unreadable && eabSwitch);

	// a value changed after an answer: the answer no longer fits
	const signature = JSON.stringify(values);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the values are the trigger
	useEffect(() => {
		setOutcome(null);
	}, [signature]);

	// EAB values typed and then hidden are not sent
	const sent = visibleEabValues(values, showEab);
	const plan = main ? connectPlan(sent, data) : otherPlan(sent, kind === "edit" ? account : null);
	const changedCa = main && server !== "" && server !== data.server;

	const refuse = (err, eabSent) => {
		const { message, field } = failureOf(err, eabSent);
		if (field) methods.setError(field, { type: "server", message });
		setOutcome({ kind: "refused", message });
	};

	const onSubmit = async (typed) => {
		const formValues = visibleEabValues(typed, showEab);
		if (plan === "nothing") return;
		const anyway = outcome?.kind === "unreachable";
		setOutcome(null);
		const target = kind === "edit" ? account.server : serverOfForm(formValues);
		const eabSent = formValues.eabKid.trim() !== "" && formValues.eabHmacKey.trim() !== "";
		const needsCheck = main
			? connectNeedsCheck(formValues, data)
			: kind === "add" || account.state !== "registered";
		if (!anyway && needsCheck) {
			try {
				// read now: a cached answer from the URL field's check may be minutes old
				const checked = main ? serverParam(data, target) : target;
				if (!directoryReachable(await getAcmeProfiles(checked, { fresh: true }))) {
					setOutcome({ kind: "unreachable" });
					return;
				}
			} catch (err) {
				refuse(err, eabSent);
				return;
			}
		}
		try {
			let result;
			if (main) {
				result =
					plan === "register"
						? await register(serverParam(data, target))
						: await save(acmePayload(formValues, data));
			} else if (kind === "add") {
				result = await addAccount(acmeAccountPayload(formValues, null));
			} else if (plan === "register") {
				result = await register(target);
			} else {
				result = await updateAccount({ id: account.id, values: acmeAccountPayload(formValues, account) });
			}
			if (connectOutcome(result) === "waiting") showSuccess(t("settings.certificates.acme.toast.waiting"));
			else showSuccess(t("settings.certificates.acme.toast.connected", { ca: caName(target) }));
			remove();
		} catch (err) {
			refuse(err, eabSent);
		}
	};

	const waiting = outcome?.kind === "unreachable";
	// an outcome box can sit below the fold of the body: it scrolls into view and takes the focus (screen readers too)
	const outcomeRef = useRef(null);
	useEffect(() => {
		if (!outcome) return;
		outcomeRef.current?.scrollIntoView({ block: "nearest" });
		outcomeRef.current?.focus({ preventScroll: true });
	}, [outcome]);
	return (
		<AppModal
			size="md"
			show={visible}
			onHide={isSubmitting ? undefined : close}
			backdrop="static"
			data-acme-connect
		>
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T
							id={
								kind === "add"
									? "settings.certificates.acme.window.title-add"
									: "settings.certificates.acme.window.title"
							}
						/>
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<div className="flex flex-col gap-3">
						{kind === "edit" ? (
							<div className="flex flex-col gap-1" data-acme-ca-fixed>
								<span className="font-medium text-sm">
									<T id="settings.certificates.acme.ca" />
								</span>
								<span className="wrap-anywhere text-sm">{caName(account.server)}</span>
								{presetOf(account.server) === CUSTOM ? (
									<span className="wrap-anywhere text-muted-foreground text-xs">
										{account.server}
									</span>
								) : null}
							</div>
						) : (
							<SelectField
								id="acme-ca"
								name="preset"
								label={<T id="settings.certificates.acme.ca" />}
								hint={
									locked.has("server") ? (
										<EnvHint env={lockedBy.server} />
									) : (
										<T id="settings.certificates.acme.ca.hint" />
									)
								}
								badges={locked.has("server") ? <LockedBadge env={lockedBy.server} windowSkip /> : null}
								disabled={locked.has("server") || isSubmitting}
								registerOptions={main ? { onChange: onPresetChange } : undefined}
							>
								{(kind === "add" ? choices : [...ACME_PRESETS.map((preset) => preset.id), CUSTOM]).map(
									(id) => (
										<option key={id} value={id}>
											{id === CUSTOM
												? t("settings.certificates.acme.ca.custom")
												: t(`acme.preset.${id}`)}
										</option>
									),
								)}
							</SelectField>
						)}
						{custom && kind !== "edit" ? (
							<TextField
								id="acme-url"
								name="customUrl"
								type="url"
								label={<T id="settings.certificates.acme.url" />}
								hint={<T id="settings.certificates.acme.url.hint" />}
								badges={locked.has("server") ? <LockedBadge env={lockedBy.server} windowSkip /> : null}
								placeholder="https://"
								autoComplete="off"
								disabled={locked.has("server") || isSubmitting}
								registerOptions={{ onBlur: onUrlBlur }}
							/>
						) : null}
						{unreadable ? (
							<SettingLineNote
								icon={TriangleAlert}
								className="rounded-md border border-warning/40 bg-warning/10"
							>
								<T id="settings.certificates.acme.directory-unreadable" />
							</SettingLineNote>
						) : null}
						{unreadable ? (
							<SwitchField
								id="acme-eab-switch"
								label={<T id="settings.certificates.acme.eab-switch" />}
								hint={<T id="settings.certificates.acme.eab-switch.hint" />}
								checked={eabSwitch}
								onChange={(event) => setEabSwitch(event.target.checked)}
								disabled={isSubmitting}
							/>
						) : null}
						<TextField
							id="acme-email"
							name="email"
							type="email"
							label={<T id="settings.certificates.acme.email" />}
							hint={
								locked.has("email") ? (
									<EnvHint env={lockedBy.email} />
								) : (
									<T id="settings.certificates.acme.email.hint" />
								)
							}
							badges={locked.has("email") ? <LockedBadge env={lockedBy.email} windowSkip /> : null}
							autoComplete="off"
							disabled={locked.has("email") || isSubmitting}
						/>
						{values.preset === "zerossl" ? (
							<SettingLineNote icon={Info}>
								<T id="settings.certificates.acme.email.zerossl" />
							</SettingLineNote>
						) : null}
						{showEab ? (
							<>
								<TextField
									id="acme-eab-kid"
									name="eabKid"
									label={<T id="settings.certificates.acme.eab-kid" />}
									hint={
										eabLocked ? (
											<EnvHint env={eabLockEnv(lockedBy, "eabKid")} />
										) : (
											<T id="settings.certificates.acme.eab-kid.hint" />
										)
									}
									badges={
										eabLocked ? (
											<LockedBadge env={eabLockEnv(lockedBy, "eabKid")} windowSkip />
										) : null
									}
									autoComplete="off"
									disabled={eabLocked || isSubmitting}
								/>
								<PasswordField
									id="acme-eab-hmac"
									name="eabHmacKey"
									label={<T id="settings.certificates.acme.eab-hmac" />}
									hint={
										eabLocked ? (
											<EnvHint env={eabLockEnv(lockedBy, "eabHmacKey")} />
										) : data.eabHmacKeySet ? (
											<T id="settings.certificates.acme.eab-hmac.saved" />
										) : (
											<T id="settings.certificates.acme.eab-hmac.hint" />
										)
									}
									badges={
										eabLocked ? (
											<LockedBadge env={eabLockEnv(lockedBy, "eabHmacKey")} windowSkip />
										) : null
									}
									autoComplete="new-password"
									disabled={eabLocked || isSubmitting}
								/>
							</>
						) : null}
						{changedCa ? (
							<SettingLineNote icon={Info} data-acme-change-note>
								<T
									id="settings.certificates.acme.window.change-note"
									data={{ new: caName(server), old: caName(data.server) }}
								/>
							</SettingLineNote>
						) : null}
						{outcome?.kind === "refused" ? (
							<div
								ref={outcomeRef}
								tabIndex={-1}
								role="alert"
								className="flex gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm outline-none"
								data-acme-refused
							>
								<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
								<div className="min-w-0">
									<p className="m-0 font-medium">
										<T id="settings.certificates.acme.window.refused" />
									</p>
									<p className="m-0 mt-0.5 break-words text-muted-foreground">{outcome.message}</p>
								</div>
							</div>
						) : null}
						{waiting ? (
							<div
								ref={outcomeRef}
								tabIndex={-1}
								role="status"
								className="flex gap-2.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm outline-none"
								data-acme-unreachable
							>
								<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
								<div className="min-w-0">
									<p className="m-0 font-medium">
										<T id="settings.certificates.acme.window.unreachable" />
									</p>
									<p className="m-0 mt-0.5 text-muted-foreground">
										<T id="settings.certificates.acme.window.unreachable.text" />
									</p>
								</div>
							</div>
						) : null}
					</div>
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<div className="flex min-w-0 flex-1 items-center justify-end gap-3">
						{plan === "nothing" ? (
							<span className="text-right text-muted-foreground text-sm">
								<T id="settings.certificates.acme.window.nothing-changed" />
							</span>
						) : null}
						<Button
							color="primary"
							type="submit"
							isLoading={isSubmitting}
							disabled={isSubmitting || plan === "nothing"}
						>
							{isSubmitting ? (
								<T id="settings.certificates.acme.window.connecting" />
							) : waiting ? (
								<T id="settings.certificates.acme.window.anyway" />
							) : (
								<T id="settings.certificates.acme.connect" />
							)}
						</Button>
					</div>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showAcmeConnectModal };
