import { IconCopy } from "@tabler/icons-react";
import cn from "clsx";
import { Field, Form, Formik } from "formik";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { disableTotp, enableTotp, getMfaStatus, regenerateBackupCodes, startTotpSetup } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { PasswordInput } from "src/components/Form";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { validateString, validateText } from "src/modules/Validations";

const showMfaModal = (id) => {
	EasyModal.show(MfaModal, { id });
};

const validateSixDigits = validateText({ required: true, pattern: /^\d{6}$/u, messageId: "error.code-six-digits" });

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

	const handleVerify = async (values) => {
		setError(null);
		setIsSubmitting(true);
		try {
			const result = await enableTotp(id, values);
			if (result.backupCodes) {
				setBackupCodes(result.backupCodes);
				setStep("backup");
			} else {
				await loadStatus();
			}
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
	};

	const handleDisable = async (values) => {
		setError(null);
		setIsSubmitting(true);
		try {
			await disableTotp(id, values);
			setIsEnabled(false);
			setStep("status");
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
	};

	const handleRegenerateBackup = async (values) => {
		setError(null);
		setIsSubmitting(true);
		try {
			const result = await regenerateBackupCodes(id, values);
			setBackupCodes(result.backupCodes);
			setStep("backup");
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
	};

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
					<Formik initialValues={{ code: "" }} onSubmit={handleVerify}>
						{() => (
							<Form noValidate>
								<Field name="code" validate={validateSixDigits}>
									{({ field, form }) => (
										<div className="mb-3">
											<PasswordInput
												{...field}
												id="mfa-code"
												label={<T id="totp.enter-code" />}
												textWhenEmpty
												inputMode="numeric"
												autoComplete="one-time-code"
												required
												className="text-center font-monospace"
												placeholder="000000"
												maxLength={6}
												error={form.errors.code && form.touched.code ? form.errors.code : null}
											/>
										</div>
									)}
								</Field>
								<div className="d-flex gap-2 align-items-start">
									<Button
										type="button"
										fullWidth
										onClick={() => setStep("status")}
										disabled={isSubmitting}
									>
										<T id="cancel" />
									</Button>
									<FormSubmit
										stacked
										className="w-100"
										messageId="form.fix-fields.continue"
										color="primary"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="totp.verify-enable" />
									</FormSubmit>
								</div>
							</Form>
						)}
					</Formik>
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
					<Formik initialValues={{ code: "" }} onSubmit={handleDisable}>
						{() => (
							<Form noValidate>
								<Field name="code" validate={validateString(6, 8)}>
									{({ field, form }) => (
										<div className="mb-3">
											<PasswordInput
												{...field}
												id="mfa-code"
												label={<T id="totp.enter-code-disable" />}
												textWhenEmpty
												autoComplete="one-time-code"
												required
												className="text-center font-monospace"
												placeholder="000000"
												maxLength={8}
												error={form.errors.code && form.touched.code ? form.errors.code : null}
											/>
										</div>
									)}
								</Field>
								<div className="d-flex gap-2 align-items-start">
									<Button
										type="button"
										fullWidth
										onClick={() => setStep("status")}
										disabled={isSubmitting}
									>
										<T id="cancel" />
									</Button>
									<FormSubmit
										stacked
										className="w-100"
										messageId="form.fix-fields.continue"
										color="danger"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="totp.disable-confirm" />
									</FormSubmit>
								</div>
							</Form>
						)}
					</Formik>
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
					<Formik initialValues={{ code: "" }} onSubmit={handleRegenerateBackup}>
						{() => (
							<Form noValidate>
								<Field name="code" validate={validateSixDigits}>
									{({ field, form }) => (
										<div className="mb-3">
											<PasswordInput
												{...field}
												id="mfa-code"
												label={<T id="totp.enter-code" />}
												textWhenEmpty
												inputMode="numeric"
												autoComplete="one-time-code"
												required
												className="text-center font-monospace"
												placeholder="000000"
												maxLength={6}
												error={form.errors.code && form.touched.code ? form.errors.code : null}
											/>
										</div>
									)}
								</Field>
								<div className="d-flex gap-2 align-items-start">
									<Button
										type="button"
										fullWidth
										onClick={() => setStep("status")}
										disabled={isSubmitting}
									>
										<T id="cancel" />
									</Button>
									<FormSubmit
										stacked
										className="w-100"
										messageId="form.fix-fields.continue"
										color="primary"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="mfa.regenerate" />
									</FormSubmit>
								</div>
							</Form>
						)}
					</Formik>
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
