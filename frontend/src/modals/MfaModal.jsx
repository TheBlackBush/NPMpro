import { IconCopy } from "@tabler/icons-react";
import cn from "clsx";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { disableTotp, enableTotp, getMfaStatus, regenerateBackupCodes, startTotpSetup } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { CodeEntry, HookForm, useAppForm } from "src/components/Form";
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
	// keepEdits false: the reset after a refused code empties the field the user typed in
	const methods = useAppForm({
		defaultValues: CODE_VALUES,
		validate: mfaCodeValidate(validations, step),
		keepEdits: false,
	});
	const { setFocus } = methods;
	const submit = async (values) => {
		if ((await onSubmit({ code: codeOf(values) })) !== false) return;
		methods.reset({ ...CODE_VALUES, useBackup: values.useBackup });
		setFocus(values.useBackup ? "backupCode" : "code");
	};
	return (
		<HookForm methods={methods} onSubmit={submit}>
			<CodeEntry idPrefix={`mfa-${step}`} label={<T id={labelId} />} allowBackup={allowBackup} />
			<div className="d-flex gap-2 align-items-start">
				<Button type="button" fullWidth onClick={onCancel} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<FormSubmit
					stacked
					className="w-100"
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
						<div className="d-flex align-items-center justify-content-between mb-2">
							<span className="fw-bold">
								<T id="totp.status" />
							</span>
							<span className={cn("status", isEnabled ? "status-green" : "status-secondary")}>
								<span className="status-dot" />
								{isEnabled ? <T id="totp.enabled" /> : <T id="totp.disabled" />}
							</span>
						</div>
						{isEnabled && (
							<p className="text-secondary small mb-0">
								<T id="mfa.backup-codes-remaining" data={{ count: backupCodesRemaining }} />
							</p>
						)}
					</div>
					{!isEnabled ? (
						<Button fullWidth color="primary" onClick={handleStartSetup} isLoading={isSubmitting}>
							<T id="totp.enable" />
						</Button>
					) : (
						<div className="d-flex flex-column gap-2">
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
					<p className="text-secondary mb-3">
						<T id="totp.setup-instructions" />
					</p>
					<div className="text-center mb-3">
						<QRCodeSVG value={setupData.otpauthUrl} size={256} marginSize={4} />
					</div>
					<label className="mb-3 d-block">
						<span className="form-label small text-secondary">
							<T id="totp.secret-key" />
						</span>
						<div className="input-group input-group-flat">
							<input
								type="text"
								className="form-control font-monospace"
								value={setupData.secret}
								readOnly
								onClick={(e) => e.target.select()}
							/>
							<span className="input-group-text py-0">
								<button
									type="button"
									aria-label={intl.formatMessage({ id: "aria.copy" })}
									className="btn btn-icon btn-ghost btn-sm"
									onClick={() => navigator.clipboard.writeText(setupData.secret)}
								>
									<IconCopy className="icon" aria-hidden="true" />
								</button>
							</span>
						</div>
					</label>
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
					<div className="mb-3">
						<div className="row g-2">
							{backupCodes.map((code, index) => (
								<div key={index} className="col-6">
									<code className="d-block p-2 text-center">{code}</code>
								</div>
							))}
						</div>
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
					<p className="text-secondary mb-3">
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
		<AppModal show={visible} onHide={closable ? remove : undefined} backdrop="static" keyboard={closable}>
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
