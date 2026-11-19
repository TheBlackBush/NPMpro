import { BookOpen, CopyIcon, ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { TokenBadges, TokenFacts, TokenPermissions } from "src/components/ApiTokenCells";
import { CodeBox } from "src/components/CodeBox";
import { HookForm, SelectField, SettingLines, SwitchField, TextField, useAppForm } from "src/components/Form";
import { TokenPermissionFields } from "src/components/Form/TokenPermissionFields";
import { TapTooltip } from "src/components/TapTooltip";
import { Button as UiButton } from "src/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "src/components/ui/input-group";
import { Label } from "src/components/ui/label";
import { useCreateApiToken, useOwnApiTokens, useRevokeApiToken, useUser } from "src/hooks";
import { useIsMobile } from "src/hooks/use-mobile";
import { intl, T } from "src/locale";
import { authHeader, EXPIRY_CHOICES, newTokenValues, ownerCaps, tokenPayload, tomorrowOf } from "src/modules/ApiTokens";
import EasyModal from "src/modules/easyModal";
import { fieldsValidate } from "src/modules/HookForm";
import { isAdmin } from "src/modules/Permissions";
import { validateRequired, validateString } from "src/modules/Validations";
import { showSuccess } from "src/notifications";

const showApiTokensModal = (id) => {
	EasyModal.show(ApiTokensModal, { id });
};

const validate = fieldsValidate((values) => ({
	name: validateString(1, 100, true),
	...(values.expiry === "date" ? { expiryDate: validateRequired() } : {}),
}));

// A step that replaces another one takes the focus (the pressed button is gone with the old step): its target, else
// its title. The first step of an opening is left to the window, which focuses its first field.
function useStepFocus(focus, target) {
	const title = useRef(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the step focuses once, when it mounts
	useEffect(() => {
		if (!focus) return;
		(target?.() ?? title.current)?.focus({ preventScroll: true });
	}, []);
	return title;
}

function TokenRow({ token, now, onRevoke }) {
	return (
		<li className="flex flex-col gap-3 border-b py-3.5 last:border-b-0 @md:flex-row @md:items-start">
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="break-words font-semibold">{token.name}</span>
					<TokenBadges token={token} now={now} />
				</div>
				<TokenPermissions token={token} />
				<TokenFacts token={token} />
			</div>
			<UiButton
				variant="destructive-outline"
				size="sm"
				className="self-start"
				aria-label={intl.formatMessage({ id: "api-tokens.revoke-name" }, { name: token.name })}
				onClick={() => onRevoke(token)}
			>
				<T id="api-tokens.revoke" />
			</UiButton>
		</li>
	);
}

function ListStep({ focus, onNew, onRevoke, onClose }) {
	const title = useStepFocus(focus);
	const baseId = useId();
	const { data, isPending, error } = useOwnApiTokens();
	const now = new Date();
	return (
		<>
			<AppModal.Header closeButton>
				<AppModal.Title ref={title} tabIndex={-1} className="outline-none" data-window-start="">
					<T id="api-tokens.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<div className="@container flex flex-col gap-4">
					<p className="m-0 text-muted-foreground text-sm">
						<T id="api-tokens.intro" />
					</p>
					{error ? <ErrorAlert error={error} /> : null}
					{isPending ? <Loading noLogo /> : null}
					{data && data.length === 0 ? (
						<p className="my-4 text-center text-muted-foreground">
							<T id="api-tokens.empty" />
						</p>
					) : null}
					{data && data.length > 0 ? (
						<ul className="m-0 list-none p-0">
							{data.map((token) => (
								<TokenRow key={token.id} token={token} now={now} onRevoke={onRevoke} />
							))}
						</ul>
					) : null}
					<section
						className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
						aria-labelledby={`${baseId}-header`}
					>
						<div className="flex items-center justify-between gap-2">
							<h3 id={`${baseId}-header`} className="m-0 font-semibold text-sm">
								<T id="api-tokens.header" />
							</h3>
							<UiButton asChild variant="ghost" size="xs">
								<a href="/api-reference" target="_blank" rel="noopener noreferrer">
									<BookOpen aria-hidden="true" />
									<T id="api-tokens.reference" />
									<ExternalLink aria-hidden="true" />
									<span className="sr-only">
										{" "}
										<T id="api-tokens.new-tab" />
									</span>
								</a>
							</UiButton>
						</div>
						<CodeBox text={authHeader()} />
					</section>
				</div>
			</AppModal.Body>
			<AppModal.Footer>
				<Button onClick={onClose}>
					<T id="action.close" />
				</Button>
				<Button className="ms-auto" color="primary" onClick={onNew}>
					<T id="api-tokens.new" />
				</Button>
			</AppModal.Footer>
		</>
	);
}

// the date input shows only for "On a date"
function ExpiryFields({ baseId }) {
	const expiry = useWatch({ name: "expiry" });
	return (
		<>
			<SelectField name="expiry" id={`${baseId}-expiry`} label={<T id="api-tokens.expiry" />}>
				{EXPIRY_CHOICES.map((choice) => (
					<option key={choice} value={choice}>
						{choice === "date"
							? intl.formatMessage({ id: "api-tokens.expiry.date" })
							: choice === "never"
								? intl.formatMessage({ id: "api-tokens.expiry.never" })
								: intl.formatMessage({ id: "api-tokens.expiry.days" }, { days: choice })}
					</option>
				))}
			</SelectField>
			{expiry === "date" ? (
				<TextField
					name="expiryDate"
					id={`${baseId}-expiry-date`}
					type="date"
					min={tomorrowOf(new Date())}
					label={<T id="api-tokens.expiry-date" />}
					required
				/>
			) : null}
		</>
	);
}

function NewStep({ focus, user, onCancel, onCreated }) {
	const baseId = useId();
	const isPhone = useIsMobile();
	// the Name field on a desktop; on a phone the title, so the on-screen keyboard does not cover the window
	const title = useStepFocus(focus, () => (isPhone ? null : document.querySelector(`[id="${baseId}-name"]`)));
	const caps = ownerCaps(user);
	const admin = isAdmin(user.roles);
	const [error, setError] = useState(null);
	const create = useCreateApiToken();
	const methods = useAppForm({ defaultValues: newTokenValues(), validate });
	const { register } = methods;
	const { isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setError(null);
		try {
			const result = await create.mutateAsync(tokenPayload(values, new Date()));
			onCreated(result.token);
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
	};
	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title ref={title} tabIndex={-1} className="outline-none">
					<T id="api-tokens.new" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				<div className="@container">
					<div className="grid grid-cols-1 gap-x-3 @md:grid-cols-2">
						<TextField
							name="name"
							id={`${baseId}-name`}
							label={<T id="api-tokens.name" />}
							autoComplete="off"
							maxLength={100}
							required
						/>
						<ExpiryFields baseId={baseId} />
					</div>
				</div>
				<TokenPermissionFields caps={caps} />
				{admin ? null : (
					<p className="m-0 text-muted-foreground text-sm">
						<T id="api-tokens.cap-note" />
					</p>
				)}
				<SettingLines>
					{admin ? (
						<SwitchField
							line
							id={`${baseId}-admin`}
							label={<T id="api-tokens.admin" />}
							hint={<T id="api-tokens.admin.help" />}
							{...register("admin")}
						/>
					) : null}
					<SwitchField
						line
						id={`${baseId}-allow-delete`}
						label={<T id="api-tokens.allow-delete" />}
						hint={<T id="api-tokens.allow-delete.help" />}
						{...register("allowDelete")}
					/>
				</SettingLines>
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<FormSubmit className="ms-auto" isLoading={isSubmitting} disabled={isSubmitting}>
					<T id="api-tokens.create" />
				</FormSubmit>
			</AppModal.Footer>
		</HookForm>
	);
}

// the token is shown once: only Done ends this step (the window has no X, no Escape)
function SecretStep({ focus, token, onDone }) {
	const id = useId();
	const input = useRef(null);
	// the token field, ready to be copied
	useStepFocus(focus, () => input.current);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(token);
			showSuccess(intl.formatMessage({ id: "api-tokens.copied" }));
		} catch {
			// no clipboard access (a browser setting or policy): select the token so it can be copied by hand
			input.current?.select();
		}
	};
	return (
		<>
			<AppModal.Header closeButton={false}>
				<AppModal.Title>
					<T id="api-tokens.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<NoticeAlert className="mb-3">
					<T id="api-tokens.secret.warning" />
				</NoticeAlert>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={id} className="text-muted-foreground">
						<T id="api-tokens.secret" />
					</Label>
					<InputGroup>
						{/* a textarea: the whole token wraps instead of running off a phone screen */}
						<InputGroupTextarea
							ref={input}
							id={id}
							rows={2}
							className="break-all font-mono text-sm"
							value={token}
							readOnly
							autoComplete="off"
							spellCheck={false}
							data-api-token-secret
							onClick={(e) => e.target.select()}
						/>
						<InputGroupAddon align="inline-end">
							<TapTooltip content={intl.formatMessage({ id: "api-tokens.copy" })} tap={false}>
								<InputGroupButton
									size="icon-xs"
									aria-label={intl.formatMessage({ id: "api-tokens.copy" })}
									onClick={copy}
								>
									<CopyIcon aria-hidden="true" />
								</InputGroupButton>
							</TapTooltip>
						</InputGroupAddon>
					</InputGroup>
				</div>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="ms-auto" color="primary" onClick={onDone}>
					<T id="api-tokens.done" />
				</Button>
			</AppModal.Footer>
		</>
	);
}

function RevokeStep({ focus, token, onCancel, onRevoked }) {
	const title = useStepFocus(focus);
	const [error, setError] = useState(null);
	const revoke = useRevokeApiToken();
	const confirm = async () => {
		setError(null);
		try {
			await revoke.mutateAsync(token.id);
			showSuccess(intl.formatMessage({ id: "api-tokens.revoked" }));
			onRevoked();
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
	};
	return (
		<>
			<AppModal.Header closeButton={!revoke.isPending}>
				<AppModal.Title ref={title} tabIndex={-1} className="outline-none">
					<T id="api-tokens.revoke" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				<p className="mb-0">
					<T id="api-tokens.revoke.confirm" data={{ name: token.name }} />
				</p>
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={onCancel} disabled={revoke.isPending}>
					<T id="cancel" />
				</Button>
				<Button className="ms-auto" color="danger" onClick={confirm} isLoading={revoke.isPending}>
					<T id="api-tokens.revoke" />
				</Button>
			</AppModal.Footer>
		</>
	);
}

const ApiTokensModal = EasyModal.create(({ id, visible, remove }) => {
	const { data: user, isPending } = useUser(id);
	const [step, setStep] = useState({ name: "list" });
	// false until the first step change: the window itself focuses the first step
	const [moved, setMoved] = useState(false);
	const go = (next) => {
		setMoved(true);
		setStep(next);
	};
	const toList = () => go({ name: "list" });
	// the secret step only ends with Done
	const closable = step.name !== "secret";

	let content = <Loading noLogo />;
	if (step.name === "list") {
		content = (
			<ListStep
				focus={moved}
				onNew={() => go({ name: "new" })}
				onRevoke={(token) => go({ name: "revoke", token })}
				onClose={remove}
			/>
		);
	} else if (step.name === "new" && user) {
		content = (
			<NewStep focus={moved} user={user} onCancel={toList} onCreated={(token) => go({ name: "secret", token })} />
		);
	} else if (step.name === "secret") {
		content = <SecretStep focus={moved} token={step.token} onDone={toList} />;
	} else if (step.name === "revoke") {
		content = <RevokeStep focus={moved} token={step.token} onCancel={toList} onRevoked={toList} />;
	}

	return (
		<AppModal
			show={visible}
			onHide={closable ? remove : undefined}
			backdrop="static"
			// one size for every step: the window keeps its kind (dialog or side sheet) from step to step
			keyboard={closable}
		>
			{isPending ? <Loading noLogo /> : content}
		</AppModal>
	);
});

export { showApiTokensModal };
