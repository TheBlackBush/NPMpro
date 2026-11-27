import { Webhook } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	Loading,
	NoticeAlert,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import { DirtyTracker, useNotificationEvents, useSaveWebhook, useUnsavedChangesGuard } from "src/hooks";
import { intl, T } from "src/locale";
import {
	isPlainHttp,
	needsUrl,
	urlMayStayEmpty,
	WEBHOOK_NAME_MAX,
	WEBHOOK_URL_MAX,
	webhookEventGroups,
	webhookPayload,
	webhookValidate,
	webhookValues,
} from "src/modules/WebhookForms";
import { showObjectSuccess } from "src/notifications";
import { showWebhookSecretModal } from "./WebhookSecretModal";

const FIELD_ORDER = ["name", "url", "allEvents", "events", "verifyTls", "enabled"];

// the labels of the fields the error note names
const NOTE_LABELS = {
	events: "settings.webhooks.events",
	url: "settings.webhooks.url",
	name: "settings.webhooks.name",
};

// the events chosen one by one: a switch per event under the heading of its area; a resolved twin is indented under
// its event. The list is one value (the ticked ids), so a blur of any switch marks the field as left.
function EventChoices({ baseId }) {
	const events = useNotificationEvents();
	const { field, fieldState } = useController({ name: "events" });
	if (events.isPending) return <Loading noLogo />;
	if (events.error) return <ErrorAlert error={events.error} />;
	const ticked = field.value ?? [];
	const groups = webhookEventGroups(events.data);
	const change = (id, on) => field.onChange(on ? [...ticked, id] : ticked.filter((item) => item !== id));
	return (
		<div className="mb-3">
			{groups.map((group) => (
				<fieldset key={group.area} className="m-0 mb-2 min-w-0 border-0 p-0">
					<legend className="mb-1 text-xs font-semibold text-muted-foreground">
						<T id={group.title} />
					</legend>
					{group.events.map((event) => (
						<SwitchField
							key={event.id}
							id={`${baseId}-event-${event.id.replaceAll(/[._]/gu, "-")}`}
							className={event.resolved ? "ms-6" : undefined}
							label={<T id={event.label} />}
							checked={ticked.includes(event.id)}
							onChange={(e) => change(event.id, e.target.checked)}
							onBlur={field.onBlur}
							ref={event === groups[0]?.events[0] ? field.ref : undefined}
						/>
					))}
				</fieldset>
			))}
			{fieldState.error?.message ? (
				<div role="alert" className="text-sm text-destructive">
					{fieldState.error.message}
				</div>
			) : null}
		</div>
	);
}

function EventsField({ baseId }) {
	const { register } = useFormContext();
	const allEvents = useWatch({ name: "allEvents" });
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="mb-1 text-sm font-medium">
				<T id="settings.webhooks.events" />
			</legend>
			<SwitchField
				{...register("allEvents")}
				id={`${baseId}-all-events`}
				className="mb-2"
				label={<T id="settings.webhooks.events.all" />}
				hint={<T id="settings.webhooks.events.all.hint" />}
			/>
			{allEvents ? null : <EventChoices baseId={baseId} />}
		</fieldset>
	);
}

function PlainHttpNote() {
	const url = useWatch({ name: "url" });
	if (!isPlainHttp(url)) return null;
	return (
		<NoticeAlert className="mb-3">
			<T id="settings.webhooks.url.plain-http" />
		</NoticeAlert>
	);
}

function WebhookForm({ webhook, errorMsg, onCloseError, close }) {
	const { register } = useFormContext();
	const { isSubmitting } = useFormState();
	const baseId = useId();
	const editing = Boolean(webhook);
	const restored = editing && needsUrl(webhook);
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title className="flex items-center gap-2">
					<Webhook className="size-5 shrink-0" aria-hidden="true" />
					<T id={editing ? "settings.webhooks.title.edit" : "settings.webhooks.title.add"} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={onCloseError}>{errorMsg}</ErrorAlert>
				{restored ? (
					<NoticeAlert className="mb-3">
						<T id="settings.webhooks.restored.note" />
					</NoticeAlert>
				) : null}
				<TextField
					name="name"
					id={`${baseId}-name`}
					label={<T id="settings.webhooks.name" />}
					maxLength={WEBHOOK_NAME_MAX}
					autoComplete="off"
					required
				/>
				<TextField
					name="url"
					id={`${baseId}-url`}
					label={<T id="settings.webhooks.url" />}
					hint={
						urlMayStayEmpty(webhook) ? (
							<T id="settings.webhooks.url.current" data={{ hint: webhook.urlHint }} />
						) : (
							<T id="settings.webhooks.url.hint" />
						)
					}
					placeholder={
						urlMayStayEmpty(webhook)
							? intl.formatMessage({ id: "settings.webhooks.url.set" })
							: "https://hooks.example.com/npmpro"
					}
					maxLength={WEBHOOK_URL_MAX + 1}
					autoComplete="off"
					autoCapitalize="none"
					spellCheck={false}
					inputMode="url"
					required={!urlMayStayEmpty(webhook)}
				/>
				<PlainHttpNote />
				<EventsField baseId={baseId} />
				<SwitchField
					{...register("verifyTls")}
					id={`${baseId}-verify-tls`}
					className="mb-3"
					label={<T id="settings.webhooks.verify-tls" />}
					hint={<T id="settings.webhooks.verify-tls.hint" />}
					disabled={isSubmitting}
				/>
				<SwitchField
					{...register("enabled")}
					id={`${baseId}-enabled`}
					className="mb-3"
					label={<T id="settings.webhooks.enabled" />}
					disabled={isSubmitting}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<FormSubmit
					className="ms-auto"
					edit={editing && !restored}
					labels={NOTE_LABELS}
					isLoading={isSubmitting}
					disabled={isSubmitting}
				>
					<T id="save" />
				</FormSubmit>
			</AppModal.Footer>
		</>
	);
}

// the form, mounted once: its defaultValues are complete from the first render
const WebhookEditor = ({ webhook, onSubmit, dirtyRef, ...formProps }) => {
	const editing = urlMayStayEmpty(webhook);
	const validate = useCallback(
		(values) =>
			Object.fromEntries(
				Object.entries(webhookValidate(values, { editing })).map(([field, { id, values: data }]) => [
					field,
					intl.formatMessage({ id }, data),
				]),
			),
		[editing],
	);
	const methods = useAppForm({ defaultValues: webhookValues(webhook), validate });
	return (
		<HookForm methods={methods} onSubmit={onSubmit} fieldOrder={FIELD_ORDER}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<WebhookForm webhook={webhook} {...formProps} />
		</HookForm>
	);
};

/**
 * The window of a webhook: name, URL (an edit keeps the stored one while the field is empty; a webhook restored from a
 * backup without its URL asks for it), the events (all, or chosen one by one), Verify TLS and Enabled. A new webhook,
 * and a restored one that is saved again, answer the signing secret once: the secret window shows it.
 */
export default function WebhookWindow({ webhook, visible, remove }) {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const save = useSaveWebhook();
	const [errorMsg, setErrorMsg] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const payload = webhookPayload(values, webhook ?? null);
			if (payload) {
				const saved = await save.mutateAsync({ id: webhook?.id, ...payload });
				showObjectSuccess("webhook", "saved");
				remove();
				if (saved?.secret) showWebhookSecretModal(saved.name ?? payload.name, saved.secret);
			} else {
				remove();
			}
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={save.isPending ? undefined : close} size="lg" backdrop="static">
			<WebhookEditor
				webhook={webhook}
				onSubmit={onSubmit}
				dirtyRef={dirtyRef}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				close={close}
			/>
		</AppModal>
	);
}
