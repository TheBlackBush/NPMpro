import { CopyIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { TokenBadges, TokenCreated, TokenExpiry, TokenLastUsed, TokenPermissions } from "src/components/ApiTokenCells";
import { HookForm, SelectField, SwitchField, SwitchList, TextField, useAppForm } from "src/components/Form";
import { FormSection } from "src/components/Form/FormSection";
import { PERMISSION_ROWS, PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { TapTooltip } from "src/components/TapTooltip";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "src/components/ui/input-group";
import { Label } from "src/components/ui/label";
import { useCreateApiToken, useOwnApiTokens, useRevokeApiToken, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { EXPIRY_CHOICES, newTokenValues, ownerCaps, tokenPayload, tomorrowOf } from "src/modules/ApiTokens";
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

function TokenRow({ token, now, onRevoke }) {
	return (
		<li className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="flex flex-wrap items-center gap-2">
					<span className="break-words font-medium">{token.name}</span>
					<TokenBadges token={token} now={now} />
				</div>
				<TokenPermissions token={token} />
				<dl className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground text-sm">
					<div className="flex gap-1">
						<dt>
							<T id="api-tokens.expires" />:
						</dt>
						<dd className="m-0">
							<TokenExpiry token={token} />
						</dd>
					</div>
					<div className="flex gap-1">
						<dt>
							<T id="api-tokens.last-used" />:
						</dt>
						<dd className="m-0">
							<TokenLastUsed token={token} />
						</dd>
					</div>
					<div className="flex gap-1">
						<dt>
							<T id="api-tokens.created" />:
						</dt>
						<dd className="m-0">
							<TokenCreated token={token} />
						</dd>
					</div>
				</dl>
			</div>
			<Button
				size="sm"
				aria-label={intl.formatMessage({ id: "api-tokens.revoke-name" }, { name: token.name })}
				onClick={() => onRevoke(token)}
			>
				<T id="api-tokens.revoke" />
			</Button>
		</li>
	);
}

function ListStep({ onNew, onRevoke, onClose }) {
	const { data, isPending, error } = useOwnApiTokens();
	const now = new Date();
	return (
		<>
			<AppModal.Header closeButton>
				<AppModal.Title>
					<T id="api-tokens.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<p className="mb-3 text-muted-foreground text-sm">
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
					<ul className="m-0 mb-3 list-none p-0">
						{data.map((token) => (
							<TokenRow key={token.id} token={token} now={now} onRevoke={onRevoke} />
						))}
					</ul>
				) : null}
				<p className="mb-0 text-muted-foreground text-sm">
					<T id="api-tokens.docs.note" /> <code className="font-mono">Authorization: Bearer YOUR_TOKEN</code>{" "}
					<a href="/api/docs" target="_blank" rel="noopener noreferrer" className="underline">
						<T id="api-tokens.docs" />
					</a>
				</p>
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

function NewStep({ user, onCancel, onCreated }) {
	const baseId = useId();
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
				<AppModal.Title>
					<T id="api-tokens.new" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				<TextField
					name="name"
					id={`${baseId}-name`}
					label={<T id="api-tokens.name" />}
					autoComplete="off"
					maxLength={100}
					required
				/>
				<ExpiryFields baseId={baseId} />
				<VisibilityButtons name="visibility" allowAll={caps.visibility === "all"} />
				<FormSection legend={<T id="api-tokens.permissions" />}>
					{PERMISSION_ROWS.map(([section, labelId]) => (
						<PermissionButtons key={section} name={section} legend={<T id={labelId} />} caps={caps} />
					))}
					{admin ? null : (
						<p className="mb-0 text-muted-foreground text-sm">
							<T id="api-tokens.cap-note" />
						</p>
					)}
				</FormSection>
				<SwitchList>
					{admin ? (
						<SwitchField
							id={`${baseId}-admin`}
							label={<T id="api-tokens.admin" />}
							hint={<T id="api-tokens.admin.help" />}
							{...register("admin")}
						/>
					) : null}
					<SwitchField
						id={`${baseId}-allow-delete`}
						label={<T id="api-tokens.allow-delete" />}
						hint={<T id="api-tokens.allow-delete.help" />}
						{...register("allowDelete")}
					/>
				</SwitchList>
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
function SecretStep({ token, onDone }) {
	const id = useId();
	const input = useRef(null);
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

function RevokeStep({ token, onCancel, onRevoked }) {
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
				<AppModal.Title>
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
	const toList = () => setStep({ name: "list" });
	// the secret step only ends with Done
	const closable = step.name !== "secret";

	let content = <Loading noLogo />;
	if (step.name === "list") {
		content = (
			<ListStep
				onNew={() => setStep({ name: "new" })}
				onRevoke={(token) => setStep({ name: "revoke", token })}
				onClose={remove}
			/>
		);
	} else if (step.name === "new" && user) {
		content = <NewStep user={user} onCancel={toList} onCreated={(token) => setStep({ name: "secret", token })} />;
	} else if (step.name === "secret") {
		content = <SecretStep token={step.token} onDone={toList} />;
	} else if (step.name === "revoke") {
		content = <RevokeStep token={step.token} onCancel={toList} onRevoked={toList} />;
	}

	return (
		<AppModal
			show={visible}
			onHide={closable ? remove : undefined}
			backdrop="static"
			keyboard={closable}
			size={step.name === "new" ? undefined : "sm"}
		>
			{isPending ? <Loading noLogo /> : content}
		</AppModal>
	);
});

export { showApiTokensModal };
