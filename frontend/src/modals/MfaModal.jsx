import { CopyIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";
import { disableTotp, enableTotp, getMfaStatus, regenerateBackupCodes, startTotpSetup } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { CodeEntry, HookForm, useAppForm, useRefusedCodeReset } from "src/components/Form";
import { StatusBadge } from "src/components/StatusBadge";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "src/components/ui/input-group";
import { Label } from "src/components/ui/label";
import { intl, T } from "src/locale";
import { CODE_VALUES, codeOf, mfaCodeValidate } from "src/modules/AccountForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";

const showMfaModal = (id) => {
	EasyModal.show(MfaModal, { id });
};

/**
 * The code form of a step (setup, disable, verify): the code (the six boxes; turning two-factor off also takes a
 * backup code), Cancel back to the status and the step's button. onSubmit({ code }) returns false when the code was
 * refused: the field is emptied and gets the focus again.
 */
function CodeForm({ step, labelId, allowBackup = false, color, submitId, onSubmit, onCancel, isSubmitting }) {
	const methods = useAppForm({
		defaultValues: CODE_VALUES,
		validate: mfaCodeValidate(validations, step),
		keepEdits: false,
	});
	const refuse = useRefusedCodeReset(methods);
	const submit = async (values) => {
		if ((await onSubmit({ code: codeOf(values) })) !== false) return;
		refuse(values.useBackup);
	};
	return (
		<HookForm methods={methods} onSubmit={submit}>
			<CodeEntry idPrefix={`mfa-${step}`} label={<T id={labelId} />} allowBackup={allowBackup} />
			{/* two equal columns: Cancel and the step's button are as wide as each other, the note goes under the button */}
			<div className="grid grid-cols-2 items-start gap-2">
				<Button type="button" fullWidth onClick={onCancel} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<FormSubmit
					stacked
					className="min-w-0"
					messageId="form.fix-fields.continue"
					color={color}
					isLoading={isSubmitting}
					disabled={isSubmitting}
				>
					<T id={submitId} />
				</FormSubmit>
			</div>
		</HookForm>
	);
}

// the secret of the authenticator app as text (for apps that cannot scan), read-only, with a copy button
function SecretKey({ secret }) {
	const id = useId();
	return (
		<div className="mb-3 flex flex-col gap-1.5">
			<Label htmlFor={id} className="text-muted-foreground">
				<T id="totp.secret-key" />
			</Label>
			<InputGroup>
				<InputGroupInput
					id={id}
					className="font-mono"
					value={secret}
					readOnly
					onClick={(e) => e.target.select()}
				/>
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						size="icon-xs"
						aria-label={intl.formatMessage({ id: "aria.copy" })}
						onClick={() => navigator.clipboard.writeText(secret)}
					>
						<CopyIcon aria-hidden="true" />
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

const MfaModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const [step, setStep] = useState("loading");
	const [isEnabled, setIsEnabled] = useState(false);
	const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);
	const [setupData, setSetupData] = useState(null);
	const [backupCodes, setBackupCodes] = useState([]);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const loadStatus = useCallback(async () => {
		try {
			const status = await getMfaStatus(id);
			setIsEnabled(status.totpEnabled);
			setBackupCodesRemaining(status.backupCodesRemaining);
			setStep("status");
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
			setStep("error");
		}
	}, [id]);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	const handleStartSetup = async () => {
		setError(null);
		setIsSubmitting(true);
		try {
			const data = await startTotpSetup(id);
			setSetupData(data);
			setStep("setup");
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
	};

	// a code step's request: false when it was refused (the code form empties its field)
	const submitCode = async (request) => {
		setError(null);
		setIsSubmitting(true);
		try {
			await request();
			return true;
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
			return false;
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleVerify = (payload) =>
		submitCode(async () => {
			const result = await enableTotp(id, payload);
			if (result.backupCodes) {
				setBackupCodes(result.backupCodes);
				setStep("backup");
			} else {
				await loadStatus();
			}
		});

	const handleDisable = (payload) =>
		submitCode(async () => {
			await disableTotp(id, payload);
			setIsEnabled(false);
			setStep("status");
		});

	const handleRegenerateBackup = (payload) =>
		submitCode(async () => {
			const result = await regenerateBackupCodes(id, payload);
			setBackupCodes(result.backupCodes);
			setStep("backup");
		});

	const handleBackupDone = () => {
		setIsEnabled(true);
		setBackupCodes([]);
		void loadStatus();
	};

	const renderContent = () => {
		if (step === "loading") {
			return <Loading noLogo />;
		}

		if (step === "status") {
			return (
				<div className="py-2">
					<div className="mb-4">
						<div className="mb-2 flex items-center justify-between gap-2">
							<span className="font-medium">
								<T id="totp.status" />
							</span>
							<StatusBadge tone={isEnabled ? "success" : "muted"}>
								{isEnabled ? <T id="totp.enabled" /> : <T id="totp.disabled" />}
							</StatusBadge>
						</div>
						{isEnabled && (
							<p className="mb-0 text-muted-foreground text-sm">
								<T id="mfa.backup-codes-remaining" data={{ count: backupCodesRemaining }} />
							</p>
						)}
					</div>
					{!isEnabled ? (
						<Button fullWidth color="primary" onClick={handleStartSetup} isLoading={isSubmitting}>
							<T id="totp.enable" />
						</Button>
					) : (
						<div className="flex flex-col gap-2">
							<Button fullWidth onClick={() => setStep("disable")}>
								<T id="totp.disable" />
							</Button>
							<Button fullWidth onClick={() => setStep("verify")}>
								<T id="mfa.regenerate-backup" />
							</Button>
						</div>
					)}
				</div>
			);
		}

		if (step === "setup") {
			return (
				<div className="py-2">
					<NoticeAlert>
						<T id="logout-other-devices" />
					</NoticeAlert>
					<p className="mb-3 text-muted-foreground text-sm">
						<T id="totp.setup-instructions" />
					</p>
					<div className="mb-3 flex justify-center">
						<QRCodeSVG value={setupData.otpauthUrl} size={256} marginSize={4} />
					</div>
					<SecretKey secret={setupData.secret} />
					<CodeForm
						key="setup"
						step="setup"
						labelId="totp.enter-code"
						color="primary"
						submitId="totp.verify-enable"
						onSubmit={handleVerify}
						onCancel={() => setStep("status")}
						isSubmitting={isSubmitting}
					/>
				</div>
			);
		}

		if (step === "backup") {
			return (
				<div className="py-2">
					<NoticeAlert>
						<T id="mfa.backup-warning" />
					</NoticeAlert>
					<div className="mb-3 grid grid-cols-2 gap-2">
						{backupCodes.map((code, index) => (
							<code key={index} className="block rounded-md bg-muted p-2 text-center font-mono">
								{code}
							</code>
						))}
					</div>
					<Button fullWidth color="primary" onClick={handleBackupDone}>
						<T id="totp.done" />
					</Button>
				</div>
			);
		}

		if (step === "disable") {
			return (
				<div className="py-2">
					<NoticeAlert>
						<T id="totp.disable-warning" />
					</NoticeAlert>
					<CodeForm
						key="disable"
						step="disable"
						labelId="totp.enter-code-disable"
						allowBackup
						color="danger"
						submitId="totp.disable-confirm"
						onSubmit={handleDisable}
						onCancel={() => setStep("status")}
						isSubmitting={isSubmitting}
					/>
				</div>
			);
		}

		if (step === "verify") {
			return (
				<div className="py-2">
					<NoticeAlert>
						<T id="logout-other-devices" />
					</NoticeAlert>
					<p className="mb-3 text-muted-foreground text-sm">
						<T id="mfa.regenerate-instructions" />
					</p>
					<CodeForm
						key="verify"
						step="verify"
						labelId="totp.enter-code"
						color="primary"
						submitId="mfa.regenerate"
						onSubmit={handleRegenerateBackup}
						onCancel={() => setStep("status")}
						isSubmitting={isSubmitting}
					/>
				</div>
			);
		}

		return null;
	};

	// the backup codes are shown once: that step only ends with Done, not with Escape, a backdrop click or the X
	const closable = !isSubmitting && step !== "backup";

	return (
		<AppModal size="sm" show={visible} onHide={closable ? remove : undefined} backdrop="static" keyboard={closable}>
			<AppModal.Header closeButton={closable}>
				<AppModal.Title>
					<T id="mfa.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				{renderContent()}
			</AppModal.Body>
			{["loading", "error", "status"].includes(step) && (
				<AppModal.Footer>
					<Button className="ms-auto" onClick={remove} disabled={isSubmitting}>
						<T id="action.close" />
					</Button>
				</AppModal.Footer>
			)}
		</AppModal>
	);
});

export { showMfaModal };
