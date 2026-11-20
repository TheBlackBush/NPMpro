import { Info } from "lucide-react";
import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	PasswordField,
	RequestProgress,
	SettingLineNote,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import { DirtyTracker, useAcmeProfiles, useReplaceAcmeAccount, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { acmeServerLabel, eabShown, presetOf, replaceDefaults, replacePayload } from "src/modules/AcmeAccount";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showSuccess, showWarning } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const showReplaceAcmeAccountModal = ({ server, account }) => {
	EasyModal.show(ReplaceAcmeAccountModal, { server, account });
};

const t = (id, values) => intl.formatMessage({ id }, values);

const caName = (server) => {
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? t(labelId) : text;
};

const EMAIL = /^[^\s@]+@[^\s@]+$/u;

// the email is optional but must look like one; the EAB pair is given whole or not at all
const replaceValidate = (showEab) => (values) => {
	const errors = {};
	const email = values.email.trim();
	if (email !== "" && !EMAIL.test(email)) errors.email = validations.message("error.invalid-email");
	if (showEab) {
		const kid = values.eabKid.trim() !== "";
		const hmac = values.eabHmacKey.trim() !== "";
		if (kid && !hmac) errors.eabHmacKey = validations.message("error.required");
		if (hmac && !kid) errors.eabKid = validations.message("error.required");
	}
	return errors;
};

/** The toast after a replace: what moved and what became of the old account */
const showReplaced = (replaced) => {
	const oldAccount = replaced?.oldAccount ?? "kept";
	// ICU select keys cannot hold a hyphen
	const text = t("acme-replace.done", {
		count: replaced?.moved ?? 0,
		old: oldAccount === "deactivation-failed" ? "failed" : oldAccount,
	});
	if (oldAccount === "deactivation-failed") {
		showWarning(replaced.deactivationError ? `${text} ${replaced.deactivationError}` : text);
	} else {
		showSuccess(text);
	}
};

const ReplaceAcmeAccountModal = EasyModal.create(({ server, account, visible, remove }) => {
	const { mutateAsync: replace } = useReplaceAcmeAccount();
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const [errorMsg, setErrorMsg] = useState(null);
	const preset = presetOf(server);
	const { data: directory } = useAcmeProfiles(server, { enabled: preset === "custom" });
	const showEab = eabShown({
		preset,
		externalAccountRequired: preset === "custom" ? directory?.externalAccountRequired : undefined,
		account: null,
	});
	const methods = useAppForm({ defaultValues: replaceDefaults(account), validate: replaceValidate(showEab) });
	const { isSubmitting } = methods.formState;

	const onSubmit = async (formValues) => {
		setErrorMsg(null);
		try {
			const result = await replace(replacePayload(server, formValues));
			showReplaced(result?.replaced);
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal
			size="md"
			show={visible}
			onHide={isSubmitting ? undefined : close}
			backdrop="static"
			data-acme-replace
		>
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="acme-replace.title" data={{ ca: caName(server) }} />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					<p className="mb-3 text-sm">
						<T id="acme-replace.intro" />
					</p>
					<SettingLineNote icon={Info}>
						<T id="acme-replace.keep" />
					</SettingLineNote>
					<div className="mt-3 flex flex-col gap-3">
						<TextField
							id="acme-replace-email"
							name="email"
							type="email"
							label={<T id="settings.certificates.acme.email" />}
							hint={<T id="settings.certificates.acme.email.hint" />}
							autoComplete="off"
							disabled={isSubmitting}
						/>
						{preset === "zerossl" ? (
							<SettingLineNote icon={Info}>
								<T id="settings.certificates.acme.email.zerossl" />
							</SettingLineNote>
						) : null}
						{showEab ? (
							<>
								<TextField
									id="acme-replace-eab-kid"
									name="eabKid"
									label={<T id="settings.certificates.acme.eab-kid" />}
									hint={<T id="settings.certificates.acme.eab-kid.hint" />}
									autoComplete="off"
									disabled={isSubmitting}
								/>
								<PasswordField
									id="acme-replace-eab-hmac"
									name="eabHmacKey"
									label={<T id="settings.certificates.acme.eab-hmac" />}
									hint={<T id="settings.certificates.acme.eab-hmac.hint" />}
									autoComplete="new-password"
									disabled={isSubmitting}
								/>
							</>
						) : null}
						<SwitchField
							id="acme-replace-deactivate"
							label={<T id="acme-replace.deactivate" />}
							hint={<T id="acme-replace.deactivate.hint" />}
							disabled={isSubmitting}
							{...methods.register("deactivateOld")}
						/>
					</div>
					<RequestProgress running={isSubmitting} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit color="danger" isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="acme-replace.submit" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showReplaceAcmeAccountModal };
