import { CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	AddressListField,
	ApiErrorContent,
	Button,
	ErrorAlert,
	HookForm,
	Loading,
	PasswordField,
	SelectField,
	SettingLineNote,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import {
	useEmailSettings,
	useNotificationEvents,
	useNotificationSettings,
	useSaveEmailSettings,
	useSaveNotificationSettings,
	useSendSampleAlert,
	useUser,
} from "src/hooks";
import { intl, T } from "src/locale";
import { showTestMailModal } from "src/modals";
import {
	alertEventGroups,
	browserPublicUrl,
	configErrorItems,
	emailPayload,
	emailValues,
	MAIL_LANGUAGES,
	notificationPayload,
	notificationsValidate,
	notificationValues,
	PASSWORD_ENV,
	REMINDER_HOURS_MAX,
	refusedAddressOf,
	sampleFailureOf,
	sendsPlainLogin,
	stillRefused,
} from "src/modules/NotificationForms";
import { lockedIn } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess, showSuccess } from "src/notifications";
import localeList from "translations/lang-list.json" with { type: "json" };
import { LockedBadge } from "./Authentication/LockedBadge";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsForm } from "./SettingsForm";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsLead } from "./SettingsLead";
import { StatusAlert } from "./StatusAlert";

// field name -> label, for the note next to Save (the inputs' ids differ from the field names)
const FIELD_LABELS = {
	host: "settings.email.host",
	port: "settings.email.port",
	security: "settings.email.security",
	username: "settings.email.username",
	password: "settings.email.password",
	fromName: "settings.email.from-name",
	fromAddress: "settings.email.from-address",
	replyTo: "settings.email.reply-to",
	invitations: "settings.email.invitations",
	accountNotices: "settings.email.account-notices",
	publicUrl: "settings.notifications.public-url",
	defaultLanguage: "settings.notifications.default-language",
	alertsAddresses: "settings.notifications.alerts-addresses",
	reminderHours: "settings.notifications.reminder-hours",
};

// the card and its table load after the page, so the startup stays small
const WebhooksCard = lazy(() => import("./Notifications/WebhookTable"));

const label = (id) => intl.formatMessage({ id });

// the lock of one setting group: whether a field is set by an environment variable and its badge
const useLocks = (data, fixedNames = {}) => {
	const isLocked = lockedIn(data.locked);
	return {
		isLocked,
		badge: (name) => (isLocked(name) ? <LockedBadge env={fixedNames[name] ?? data.lockedBy?.[name]} /> : null),
	};
};

// Send test mail: needs saved settings (the test uses what is stored), hidden while mail is not configured
function TestMailButton({ configured, defaultTo }) {
	const { isDirty } = useFormState();
	if (!configured) return null;
	return (
		<div className="flex items-center gap-2">
			{isDirty ? (
				<span className="text-sm text-muted-foreground">
					<T id="settings.email.test.save-first" />
				</span>
			) : null}
			<Button outline color="secondary" disabled={isDirty} onClick={() => showTestMailModal(defaultTo)}>
				<T id="settings.email.test" />
			</Button>
		</div>
	);
}

// the saved values the sender refuses (a restored backup, an env value): mail is not sent until they are corrected
function ConfigErrors({ email, notifications }) {
	const items = configErrorItems(email, notifications);
	if (items.length === 0) return null;
	return (
		<StatusAlert variant="danger" icon={CircleAlert}>
			<p>
				<T id="settings.notifications.config-errors" />
			</p>
			<ul className="mt-1 list-disc ps-5">
				{items.map((item) => (
					<li key={item.field}>
						<span className="font-medium">
							<T id={item.label} />
						</span>
						: <T id={item.error} />
					</li>
				))}
			</ul>
		</StatusAlert>
	);
}

function PasswordLine({ data, locks }) {
	const { setValue } = useFormContext();
	const clearPassword = useWatch({ name: "clearPassword" });
	const locked = locks.isLocked("password");
	let placeholder = label("settings.email.password.empty");
	if (locked) placeholder = label("settings.authentication.locked");
	else if (clearPassword) placeholder = label("settings.email.password.removed");
	else if (data.passwordSet && !data.secretError) placeholder = label("settings.email.password.saved");
	return (
		<PasswordField
			line="block"
			name="password"
			id="email-password"
			label={<T id="settings.email.password" />}
			hint={<T id="settings.email.password.hint" />}
			badges={locks.badge("password")}
			autoComplete="new-password"
			disabled={locked || clearPassword}
			placeholder={placeholder}
			aside={
				data.passwordSet && !locked ? (
					<Button
						outline
						color="secondary"
						size="sm"
						onClick={() => setValue("clearPassword", !clearPassword, { shouldDirty: true })}
					>
						<T id={clearPassword ? "settings.email.password.keep" : "settings.email.password.remove"} />
					</Button>
				) : null
			}
		/>
	);
}

function PlainLoginWarning() {
	const [security, username] = useWatch({ name: ["security", "username"] });
	if (!sendsPlainLogin({ security, username })) return null;
	return (
		<SettingLineNote role="status" icon={TriangleAlert}>
			<T id="settings.email.plain-login" />
		</SettingLineNote>
	);
}

function MailServerCard({ data, locks, defaultTo }) {
	const { register } = useFormContext();
	return (
		<SettingsCard
			id="notifications-mail"
			lines
			title={<T id="settings.email.server" />}
			info={<T id="settings.email.server.description" />}
			actions={<TestMailButton configured={data.configured} defaultTo={defaultTo} />}
		>
			<TextField
				line="inline"
				name="host"
				id="email-host"
				label={<T id="settings.email.host" />}
				hint={<T id="settings.email.host.hint" />}
				badges={locks.badge("host")}
				disabled={locks.isLocked("host")}
				autoComplete="off"
				spellCheck={false}
				placeholder="smtp.example.com"
			/>
			<TextField
				line="inline"
				name="port"
				id="email-port"
				label={<T id="settings.email.port" />}
				badges={locks.badge("port")}
				disabled={locks.isLocked("port")}
				inputMode="numeric"
				autoComplete="off"
			/>
			<SelectField
				line="inline"
				name="security"
				id="email-security"
				label={<T id="settings.email.security" />}
				hint={<T id="settings.email.security.hint" />}
				badges={locks.badge("security")}
				disabled={locks.isLocked("security")}
			>
				<option value="starttls">{label("settings.email.security.starttls")}</option>
				<option value="tls">{label("settings.email.security.tls")}</option>
				<option value="none">{label("settings.email.security.none")}</option>
			</SelectField>
			<SwitchField
				line
				id="email-verify-tls"
				label={<T id="settings.email.verify-tls" />}
				hint={<T id="settings.email.verify-tls.hint" />}
				badges={locks.badge("verifyTls")}
				disabled={locks.isLocked("verifyTls")}
				{...register("verifyTls")}
			/>
			<TextField
				line="inline"
				name="username"
				id="email-username"
				label={<T id="settings.email.username" />}
				hint={<T id="settings.email.username.hint" />}
				badges={locks.badge("username")}
				disabled={locks.isLocked("username")}
				autoComplete="off"
				spellCheck={false}
			/>
			<PasswordLine data={data} locks={locks} />
			<PlainLoginWarning />
			<TextField
				line="inline"
				name="fromName"
				id="email-from-name"
				label={<T id="settings.email.from-name" />}
				hint={<T id="settings.email.from-name.hint" />}
				badges={locks.badge("fromName")}
				disabled={locks.isLocked("fromName")}
				autoComplete="off"
				placeholder="NPMpro"
			/>
			<TextField
				line="inline"
				name="fromAddress"
				id="email-from-address"
				label={<T id="settings.email.from-address" />}
				badges={locks.badge("fromAddress")}
				disabled={locks.isLocked("fromAddress")}
				type="email"
				autoComplete="off"
				spellCheck={false}
				placeholder="npmpro@example.com"
			/>
			<TextField
				line="inline"
				name="replyTo"
				id="email-reply-to"
				label={<T id="settings.email.reply-to" />}
				hint={<T id="settings.email.reply-to.hint" />}
				badges={locks.badge("replyTo")}
				disabled={locks.isLocked("replyTo")}
				type="email"
				autoComplete="off"
				spellCheck={false}
			/>
			<SwitchField
				line
				id="email-invitations"
				label={<T id="settings.email.invitations" />}
				hint={<T id="settings.email.invitations.hint" />}
				badges={locks.badge("invitations")}
				disabled={locks.isLocked("invitations")}
				{...register("invitations")}
			/>
			<SwitchField
				line
				id="email-account-notices"
				label={<T id="settings.email.account-notices" />}
				hint={<T id="settings.email.account-notices.hint" />}
				badges={locks.badge("accountNotices")}
				disabled={locks.isLocked("accountNotices")}
				{...register("accountNotices")}
			/>
		</SettingsCard>
	);
}

// Send a sample: needs saved settings (it goes to the saved recipients), so it waits while the form has changes; a
// failure names the address it failed for
function SampleAlertButton({ onError }) {
	const { isDirty } = useFormState();
	const { mutateAsync: send, isPending } = useSendSampleAlert();
	const onClick = async () => {
		onError(null);
		try {
			const { sent } = await send();
			showSuccess(<T id="settings.notifications.alerts.test.sent" data={{ count: sent }} />);
		} catch (err) {
			// the shared limiter and the one-at-a-time guard answer 429 in English: show the translated text
			if (err?.status === 429) {
				onError(<T id="error.too-many-requests" />);
				return;
			}
			const failure = sampleFailureOf(err);
			if (!failure) {
				onError(<ApiErrorContent error={err} />);
				return;
			}
			onError(
				<>
					<T
						id="settings.notifications.alerts.test.failed"
						data={{ address: failure.address, message: <ApiErrorContent error={err} /> }}
					/>
					{failure.sent > 0 || failure.skipped > 0 || failure.failed > 1 ? (
						<>
							{" "}
							<T id="settings.notifications.alerts.test.counts" data={failure} />
						</>
					) : null}
				</>,
			);
		}
	};
	return (
		<div className="flex items-center gap-2">
			{isDirty ? (
				<span className="text-sm text-muted-foreground">
					<T id="settings.email.test.save-first" />
				</span>
			) : null}
			<Button outline color="secondary" disabled={isDirty || isPending} onClick={onClick}>
				{isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
				<T id="settings.notifications.alerts.test" />
			</Button>
		</div>
	);
}

// the event switches, one line each under the heading of its area; the list is one value (the ticked ids)
function AlertEvents({ events }) {
	const { field } = useController({ name: "alertsEvents" });
	if (events.isPending) {
		return (
			<SettingLineNote role="status" className="text-sm text-muted-foreground">
				<T id="settings.notifications.alerts.events.loading" />
			</SettingLineNote>
		);
	}
	if (events.error) {
		return (
			<SettingLineNote>
				<ErrorAlert error={events.error} />
			</SettingLineNote>
		);
	}
	const ticked = field.value ?? [];
	return alertEventGroups(events.data).map((group) => (
		<fieldset key={group.area} className="m-0 min-w-0 divide-y border-0 p-0">
			<legend className="w-full bg-muted/50 px-4 py-2 text-xs font-semibold text-muted-foreground">
				<T id={group.title} />
			</legend>
			{group.events.map((event) => (
				<SwitchField
					key={event.id}
					line
					id={`alert-event-${event.id.replaceAll(/[._]/gu, "-")}`}
					label={<T id={event.label} />}
					checked={ticked.includes(event.id)}
					onChange={(e) =>
						field.onChange(
							e.target.checked ? [...ticked, event.id] : ticked.filter((id) => id !== event.id),
						)
					}
					onBlur={field.onBlur}
				/>
			))}
		</fieldset>
	));
}

// hidden until a mail server is set up (the caller): alerts are never queued without one
function MailAlertsCard({ locks, events, onError, refused }) {
	const { register } = useFormContext();
	const addresses = useWatch({ name: "alertsAddresses" });
	return (
		<SettingsCard
			id="notifications-alerts"
			lines
			title={<T id="settings.notifications.alerts" />}
			info={<T id="settings.notifications.alerts.description" />}
			actions={<SampleAlertButton onError={onError} />}
		>
			<SwitchField
				line
				id="alerts-admins"
				label={<T id="settings.notifications.alerts-admins" />}
				hint={<T id="settings.notifications.alerts-admins.hint" />}
				badges={locks.badge("alertsAdmins")}
				disabled={locks.isLocked("alertsAdmins")}
				{...register("alertsAdmins")}
			/>
			<AddressListField
				name="alertsAddresses"
				id="alerts-addresses"
				label={<T id="settings.notifications.alerts-addresses" />}
				hint={<T id="settings.notifications.alerts-addresses.hint" />}
				badges={locks.badge("alertsAddresses")}
				disabled={locks.isLocked("alertsAddresses")}
				placeholder={label("settings.notifications.alerts-addresses.placeholder")}
				refused={stillRefused(refused, addresses)}
			/>
			<AlertEvents events={events} />
			<TextField
				line="inline"
				name="reminderHours"
				id="alerts-reminder-hours"
				label={<T id="settings.notifications.reminder-hours" />}
				hint={<T id="settings.notifications.reminder-hours.hint" data={{ max: REMINDER_HOURS_MAX }} />}
				badges={locks.badge("reminderHours")}
				disabled={locks.isLocked("reminderHours")}
				inputMode="numeric"
				autoComplete="off"
			/>
		</SettingsCard>
	);
}

function PublicUrlButton({ disabled }) {
	const { setValue } = useFormContext();
	const origin = browserPublicUrl(window.location);
	return (
		<Button
			outline
			color="secondary"
			size="sm"
			disabled={disabled || !origin}
			onClick={() => setValue("publicUrl", origin, { shouldDirty: true, shouldValidate: true })}
		>
			<T id="settings.notifications.public-url.use-browser" />
		</Button>
	);
}

function LinksCard({ locks }) {
	const urlLocked = locks.isLocked("publicUrl");
	const httpsOnly = !browserPublicUrl(window.location);
	return (
		<SettingsCard
			id="notifications-links"
			lines
			title={<T id="settings.notifications.links" />}
			info={<T id="settings.notifications.links.description" />}
		>
			<TextField
				line="block"
				name="publicUrl"
				id="notifications-public-url"
				label={<T id="settings.notifications.public-url" />}
				hint={<T id="settings.notifications.public-url.hint" />}
				badges={locks.badge("publicUrl")}
				disabled={urlLocked}
				type="url"
				autoComplete="off"
				spellCheck={false}
				placeholder="https://npm.example.com"
				aside={<PublicUrlButton disabled={urlLocked} />}
			/>
			{httpsOnly && !urlLocked ? (
				<SettingLineNote role="status" className="text-sm text-muted-foreground">
					<T id="settings.notifications.public-url.https-only" />
				</SettingLineNote>
			) : null}
			<SelectField
				line="inline"
				name="defaultLanguage"
				id="notifications-default-language"
				label={<T id="settings.notifications.default-language" />}
				hint={<T id="settings.notifications.default-language.hint" />}
				badges={locks.badge("defaultLanguage")}
				disabled={locks.isLocked("defaultLanguage")}
			>
				{MAIL_LANGUAGES.map((code) => (
					<option key={code} value={code}>
						{localeList[code].name}
					</option>
				))}
			</SelectField>
		</SettingsCard>
	);
}

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch; the password
 * field is emptied after a save, a saved password is never shown. The two areas are saved by their own requests, only
 * the one that changed.
 */
function NotificationsForm({ email, notifications }) {
	const { mutateAsync: saveEmail } = useSaveEmailSettings();
	const { mutateAsync: saveNotifications } = useSaveNotificationSettings();
	const { data: me } = useUser("me");
	const events = useNotificationEvents({ enabled: email.configured });
	const [errorMsg, setErrorMsg] = useState(null);
	const [refusedAddress, setRefusedAddress] = useState(null);
	const errorRef = useRef(null);
	const emailLocks = useLocks(email, { password: PASSWORD_ENV });
	const notificationLocks = useLocks(notifications);
	const saved = { ...emailValues(email), ...notificationValues(notifications) };
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		validate: notificationsValidate(
			validations,
			{ isEmailLocked: emailLocks.isLocked, isNotificationsLocked: notificationLocks.isLocked },
			{ savedEmail: emailValues(email), savedNotifications: notificationValues(notifications) },
		),
	});

	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		setRefusedAddress(null);
		try {
			const emailBody = emailPayload(values, email);
			if (emailBody) await saveEmail(emailBody);
			const notificationBody = notificationPayload(values, notifications, events.data);
			if (notificationBody) {
				try {
					await saveNotifications(notificationBody);
				} catch (err) {
					// the saved mail server reloaded the form: the card that failed keeps the user's edit
					if (emailBody) {
						for (const key of Object.keys(notificationValues(notifications))) {
							methods.setValue(key, values[key], { shouldDirty: true });
						}
					}
					throw err;
				}
			}
			methods.setValue("password", "", { shouldDirty: true });
			methods.setValue("clearPassword", false, { shouldDirty: true });
			showObjectSuccess("setting", "saved");
		} catch (err) {
			const refused = refusedAddressOf(err, values.alertsAddresses);
			setRefusedAddress(refused);
			setErrorMsg(
				refused ? (
					<T id="settings.notifications.alerts-addresses.refused" data={{ address: refused }} />
				) : (
					<ApiErrorContent error={err} />
				),
			);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="space-y-4">
			<SettingsHeading titleId="settings.notifications" />
			<div ref={errorRef} tabIndex={-1} className="empty:hidden">
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
			</div>
			<SettingsLead id="settings.notifications.intro" />
			{email.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.email.secret-error" />
			) : null}
			<ConfigErrors email={email} notifications={notifications} />
			<MailServerCard data={email} locks={emailLocks} defaultTo={me?.email} />
			{email.configured ? (
				<MailAlertsCard
					locks={notificationLocks}
					events={events}
					onError={setErrorMsg}
					refused={refusedAddress}
				/>
			) : null}
			<Suspense fallback={<Loading noLogo />}>
				<WebhooksCard />
			</Suspense>
			<LinksCard locks={notificationLocks} />
			<SaveBar labels={FIELD_LABELS} />
		</HookForm>
	);
}

export default function Notifications() {
	const emailQuery = useEmailSettings();
	const notificationsQuery = useNotificationSettings();
	return (
		<SettingsForm
			titleId="settings.notifications"
			error={emailQuery.error ?? notificationsQuery.error}
			isPending={emailQuery.isPending || notificationsQuery.isPending}
		>
			{() => <NotificationsForm email={emailQuery.data} notifications={notificationsQuery.data} />}
		</SettingsForm>
	);
}
