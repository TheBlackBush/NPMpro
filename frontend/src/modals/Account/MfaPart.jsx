import { CopyIcon, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { disableTotp, enableTotp, getMfaStatus, regenerateBackupCodes, startTotpSetup } from "src/api/backend";
import { ApiErrorContent, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { CodeEntry, HookForm, SettingLine, SettingLines, useAppForm, useRefusedCodeReset } from "src/components/Form";
import { StatusBadge } from "src/components/StatusBadge";
import { TapTooltip } from "src/components/TapTooltip";
import { Button as UiButton } from "src/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "src/components/ui/input-group";
import { Label } from "src/components/ui/label";
import { useIsMobile } from "src/hooks/use-mobile";
import { intl, T } from "src/locale";
import { CODE_VALUES, codeOf, mfaCodeValidate } from "src/modules/AccountForms";
import { mfaStepFocus, mfaStepReport } from "src/modules/AccountWindow";
import { validations } from "src/modules/Validations";
import { AccountPart, usePartReport } from "./AccountPart";

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
					<TapTooltip content={intl.formatMessage({ id: "aria.copy" })} tap={false}>
						<InputGroupButton
							size="icon-xs"
							aria-label={intl.formatMessage({ id: "aria.copy" })}
							onClick={() => navigator.clipboard.writeText(secret)}
						>
							<CopyIcon aria-hidden="true" />
						</InputGroupButton>
					</TapTooltip>
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

const ME = "me";

// The own MFA: status lines, then the setup, regenerate and turn-off steps. The backup codes step locks the window
// until Done (reported to the frame). A lazy chunk with the QR code library.
export default function MfaPart() {
	const isPhone = useIsMobile();
	// read by the step focus only: a phone or desktop resize alone moves no focus
	const isPhoneRef = useRef(isPhone);
	isPhoneRef.current = isPhone;
	const heading = useRef(null);
	const doneButton = useRef(null);
	const stepMoved = useRef(false);
	const firstStatus = useRef(true);
	const [error, setError] = useState(null);
	const [step, setStep] = useState("loading");
	const [isEnabled, setIsEnabled] = useState(false);
	const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);
	const [setupData, setSetupData] = useState(null);
	const [backupCodes, setBackupCodes] = useState([]);
	const [isSubmitting, setIsSubmitting] = useState(false);

	usePartReport("mfa", { ...mfaStepReport(step), busy: isSubmitting });

	// a step moved by a button or a handler (not the first status, which the window start covers) takes the focus
	useEffect(() => {
		if (step === "loading") return;
		if (step === "status" && firstStatus.current) {
			firstStatus.current = false;
			return;
		}
		if (!stepMoved.current) return;
		const target = mfaStepFocus({ step, isPhone: isPhoneRef.current });
		if (target === "code") {
			// the code field (CodeEntry ids "mfa-<step>-code" or "-backup"), never the read-only secret key above it
			document.querySelector(`[data-mfa-step] input[id^="mfa-${step}-"]`)?.focus({ preventScroll: true });
		} else if (target === "done") doneButton.current?.focus({ preventScroll: true });
		else heading.current?.focus({ preventScroll: true });
	}, [step]);

	const go = (next) => {
		stepMoved.current = true;
		setStep(next);
	};

	const loadStatus = useCallback(async () => {
		try {
			const status = await getMfaStatus(ME);
			setIsEnabled(status.totpEnabled);
			setBackupCodesRemaining(status.backupCodesRemaining);
			setStep("status");
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
			setStep("error");
		}
	}, []);

	useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	const handleStartSetup = async () => {
		setError(null);
		setIsSubmitting(true);
		try {
			const data = await startTotpSetup(ME);
			setSetupData(data);
			go("setup");
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
			const result = await enableTotp(ME, payload);
			if (result.backupCodes) {
				setBackupCodes(result.backupCodes);
				go("backup");
			} else {
				await loadStatus();
			}
		});

	const handleDisable = (payload) =>
		submitCode(async () => {
			await disableTotp(ME, payload);
			setIsEnabled(false);
			go("status");
		});

	const handleRegenerateBackup = (payload) =>
		submitCode(async () => {
			const result = await regenerateBackupCodes(ME, payload);
			setBackupCodes(result.backupCodes);
			go("backup");
		});

	const handleBackupDone = () => {
		stepMoved.current = true;
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
				<>
					<SettingLines>
						<SettingLine
							id="mfa-status"
							title={<T id="totp.status" />}
							hint={
								isEnabled ? (
									<T id="mfa.backup-codes-remaining" data={{ count: backupCodesRemaining }} />
								) : (
									<T id="account.mfa.hint" />
								)
							}
							control={
								<StatusBadge tone={isEnabled ? "success" : "muted"}>
									{isEnabled ? <T id="totp.enabled" /> : <T id="totp.disabled" />}
								</StatusBadge>
							}
						/>
						{isEnabled ? (
							<>
								<SettingLine
									id="mfa-regenerate"
									title={<T id="mfa.regenerate-backup" />}
									hint={<T id="mfa.regenerate-instructions" />}
									control={
										<UiButton variant="outline" size="sm" onClick={() => go("verify")}>
											<T id="mfa.regenerate" />
										</UiButton>
									}
								/>
								<SettingLine
									id="mfa-disable"
									title={<T id="totp.disable" />}
									hint={<T id="totp.disable-warning" />}
									control={
										<UiButton variant="destructive-outline" size="sm" onClick={() => go("disable")}>
											<T id="totp.disable" />
										</UiButton>
									}
								/>
							</>
						) : null}
					</SettingLines>
					{isEnabled ? null : (
						<div className="mt-3">
							<Button color="primary" onClick={handleStartSetup} isLoading={isSubmitting}>
								<T id="totp.enable" />
							</Button>
						</div>
					)}
				</>
			);
		}

		if (step === "setup") {
			return (
				<div>
					<NoticeAlert className="mb-3">
						<T id="logout-other-devices" />
					</NoticeAlert>
					<p className="mb-3 text-muted-foreground text-sm">
						<T id="totp.setup-instructions" />
					</p>
					<div className="grid gap-4 @md:grid-cols-[auto_minmax(0,1fr)] @md:items-start">
						<div className="flex justify-center">
							<QRCodeSVG value={setupData.otpauthUrl} size={192} marginSize={4} />
						</div>
						<div className="min-w-0">
							<SecretKey secret={setupData.secret} />
							<CodeForm
								key="setup"
								step="setup"
								labelId="totp.enter-code"
								color="primary"
								submitId="totp.verify-enable"
								onSubmit={handleVerify}
								onCancel={() => go("status")}
								isSubmitting={isSubmitting}
							/>
						</div>
					</div>
				</div>
			);
		}

		if (step === "backup") {
			return (
				<div>
					<NoticeAlert className="mb-3">
						<T id="mfa.backup-warning" />
					</NoticeAlert>
					<div className="mb-3 grid grid-cols-2 gap-2">
						{backupCodes.map((code, index) => (
							<code key={index} className="block rounded-md bg-muted p-2 text-center font-mono">
								{code}
							</code>
						))}
					</div>
				</div>
			);
		}

		if (step === "disable") {
			return (
				<div>
					<NoticeAlert className="mb-3">
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
						onCancel={() => go("status")}
						isSubmitting={isSubmitting}
					/>
				</div>
			);
		}

		if (step === "verify") {
			return (
				<div>
					<NoticeAlert className="mb-3">
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
						onCancel={() => go("status")}
						isSubmitting={isSubmitting}
					/>
				</div>
			);
		}

		return null;
	};

	return (
		<AccountPart
			id="mfa"
			icon={ShieldCheck}
			heading={<T id="mfa.title" />}
			headingRef={heading}
			footer={
				step === "backup" ? (
					<Button ref={doneButton} color="primary" onClick={handleBackupDone}>
						<T id="totp.done" />
					</Button>
				) : null
			}
		>
			<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
			<div data-mfa-step={step}>{renderContent()}</div>
		</AccountPart>
	);
}
