import { BookOpen, ExternalLink, KeyRound, TerminalSquare } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { ApiErrorContent, Button, ErrorAlert, FormSubmit, Loading, NoticeAlert } from "src/components";
import { TokenBadges, TokenFacts, TokenPermissions } from "src/components/ApiTokenCells";
import { CodeBox } from "src/components/CodeBox";
import { HookForm, SelectField, SettingLines, SwitchField, TextField, useAppForm } from "src/components/Form";
import { TokenPermissionFields } from "src/components/Form/TokenPermissionFields";
import { Button as UiButton } from "src/components/ui/button";
import { useCreateApiToken, useOwnApiTokens, useRevokeApiToken, useUser } from "src/hooks";
import { useIsMobile } from "src/hooks/use-mobile";
import { intl, T } from "src/locale";
import { authHeader, EXPIRY_CHOICES, newTokenValues, ownerCaps, tokenPayload, tomorrowOf } from "src/modules/ApiTokens";
import { fieldsValidate } from "src/modules/HookForm";
import { claudeCodeCommand, endpointOf } from "src/modules/Mcp";
import { isAdmin } from "src/modules/Permissions";
import { validateRequired, validateString } from "src/modules/Validations";
import { showSuccess } from "src/notifications";
import { AccountPart, PartFormReport, usePartReport } from "./AccountPart";

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

function ListStep({ focus, onNew, onRevoke }) {
	const title = useStepFocus(focus);
	usePartReport("api-tokens", {});
	const baseId = useId();
	const { data, isPending, error } = useOwnApiTokens();
	const now = new Date();
	return (
		<AccountPart
			id="api-tokens"
			icon={KeyRound}
			heading={<T id="api-tokens.title" />}
			headingRef={title}
			footer={
				<Button color="primary" onClick={onNew}>
					<T id="api-tokens.new" />
				</Button>
			}
		>
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
					<CodeBox text={authHeader()} label={intl.formatMessage({ id: "api-tokens.header" })} />
				</section>
			</div>
		</AccountPart>
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
	// the window opens with the focus in the empty Name: an error on leaving it would move the form under the pointer
	// (a first click on Set all or a section was lost), so errors show from the first Create on
	const methods = useAppForm({ defaultValues: newTokenValues(), validate, mode: "onSubmit" });
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
		<HookForm methods={methods} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
			<PartFormReport id="api-tokens" />
			<AccountPart
				id="api-tokens"
				icon={KeyRound}
				heading={<T id="api-tokens.new" />}
				headingRef={title}
				footer={
					<>
						<Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<FormSubmit isLoading={isSubmitting} disabled={isSubmitting}>
							<T id="api-tokens.create" />
						</FormSubmit>
					</>
				}
			>
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
			</AccountPart>
		</HookForm>
	);
}

// the token is shown once: only Done ends this step (the window has no X, no Escape). Nothing here logs or stores it:
// the header and the command are built in memory and only go to the clipboard or this step's own boxes.
function SecretStep({ focus, token, onDone }) {
	const baseId = useId();
	// the token's Copy button, ready to be pressed
	useStepFocus(focus, () => document.querySelector("[data-api-token-copy]"));
	usePartReport("api-tokens", { locked: true });
	const [manual, setManual] = useState(false);
	const command = claudeCodeCommand(endpointOf(window.location.origin), token);
	const copyCommand = async () => {
		try {
			await navigator.clipboard.writeText(command);
			showSuccess(intl.formatMessage({ id: "api-tokens.secret.claude-code.copied" }));
		} catch {
			// no clipboard access: show the command so it can be copied by hand
			setManual(true);
		}
	};
	return (
		<AccountPart
			id="api-tokens"
			icon={KeyRound}
			heading={<T id="api-tokens.title" />}
			footer={
				<Button color="primary" onClick={onDone}>
					<T id="api-tokens.done" />
				</Button>
			}
		>
			<div className="flex flex-col gap-4">
				<NoticeAlert>
					<p className="m-0 font-semibold">
						<T id="api-tokens.secret.title" />
					</p>
					<p className="m-0 text-muted-foreground">
						<T id="api-tokens.secret.warning" />
					</p>
				</NoticeAlert>
				<div className="flex flex-col gap-1.5">
					<p id={`${baseId}-token`} className="m-0 font-medium text-sm">
						<T id="api-tokens.secret" />
					</p>
					<CodeBox
						text={token}
						label={intl.formatMessage({ id: "api-tokens.secret" })}
						aria-labelledby={`${baseId}-token`}
						copiedMessage={intl.formatMessage({ id: "api-tokens.copied" })}
						copyProps={{ "data-api-token-copy": "" }}
						data-api-token-secret=""
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<p id={`${baseId}-header`} className="m-0 font-medium text-sm">
						<T id="api-tokens.secret.header" />
					</p>
					<CodeBox
						text={authHeader(token)}
						label={intl.formatMessage({ id: "api-tokens.secret.header" })}
						aria-labelledby={`${baseId}-header`}
					/>
				</div>
				<div className="flex flex-col items-start gap-1.5">
					<UiButton type="button" variant="outline" size="sm" onClick={copyCommand} data-api-token-claude="">
						<TerminalSquare aria-hidden="true" />
						<T id="api-tokens.secret.claude-code" />
					</UiButton>
					<p className="m-0 text-muted-foreground text-xs">
						<T id="api-tokens.secret.claude-code.hint" />
					</p>
					{manual ? (
						<div className="flex w-full flex-col gap-1.5">
							<p className="m-0 text-sm">
								<T id="api-tokens.secret.claude-code.manual" />
							</p>
							<CodeBox
								text={command}
								label={intl.formatMessage({ id: "api-tokens.secret.claude-code" })}
								data-api-token-command=""
							/>
						</div>
					) : null}
				</div>
			</div>
		</AccountPart>
	);
}

function RevokeStep({ focus, token, onCancel, onRevoked }) {
	const title = useStepFocus(focus);
	const [error, setError] = useState(null);
	const revoke = useRevokeApiToken();
	usePartReport("api-tokens", { busy: revoke.isPending });
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
		<AccountPart
			id="api-tokens"
			icon={KeyRound}
			heading={<T id="api-tokens.revoke" />}
			headingRef={title}
			footer={
				<>
					<Button variant="ghost" onClick={onCancel} disabled={revoke.isPending}>
						<T id="cancel" />
					</Button>
					<Button color="danger" onClick={confirm} isLoading={revoke.isPending}>
						<T id="api-tokens.revoke" />
					</Button>
				</>
			}
		>
			<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
			<p className="mb-0">
				<T id="api-tokens.revoke.confirm" data={{ name: token.name }} />
			</p>
		</AccountPart>
	);
}

export function ApiTokensPart() {
	const { data: user, isPending } = useUser("me");
	const [step, setStep] = useState({ name: "list" });
	// false until the first step change: the window itself focuses the first step
	const [moved, setMoved] = useState(false);
	const go = (next) => {
		setMoved(true);
		setStep(next);
	};
	const toList = () => go({ name: "list" });

	let content = <Loading noLogo />;
	if (step.name === "list") {
		content = (
			<ListStep
				focus={moved}
				onNew={() => go({ name: "new" })}
				onRevoke={(token) => go({ name: "revoke", token })}
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

	return isPending ? <Loading noLogo /> : content;
}
