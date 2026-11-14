import { CircleAlert, CircleCheck, CircleDashed, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { ApiErrorContent, ErrorAlert, HookForm, StatusBadge, useAppForm } from "src/components";
import { Badge } from "src/components/ui/badge";
import { useOidcSettings, useSaveOidcSettings } from "src/hooks";
import { T } from "src/locale";
import { authenticationPayload, authenticationValidate, authenticationValues } from "src/modules/AuthenticationForms";
import { camel, parseDomains } from "src/modules/Oidc";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { ButtonFields } from "./Authentication/ButtonFields";
import { DefaultPermissionsFields, NewUsersFields } from "./Authentication/NewUsersFields";
import { ProviderFields } from "./Authentication/ProviderFields";
import { SignInRules } from "./Authentication/SignInRules";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsForm } from "./SettingsForm";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsLead } from "./SettingsLead";
import { StatusAlert } from "./StatusAlert";

const RULE_FIELDS = ["requireVerifiedEmail", "skipMfa", "disablePassword"];
const NEW_USER_FIELDS = ["autoCreateEnabled", "autoCreateDomains"];

function Heading() {
	return <SettingsHeading titleId="settings.authentication" />;
}

// the look of each summary kind: on (green), set by env (azure), neutral
const SUMMARY_BADGES = {
	green: ({ children }) => (
		<StatusBadge tone="success" dot={false}>
			{children}
		</StatusBadge>
	),
	azure: ({ children }) => (
		<Badge variant="outline">
			<Lock aria-hidden="true" />
			{children}
		</Badge>
	),
	secondary: ({ children }) => <Badge variant="secondary">{children}</Badge>,
};

function Summary({ color = "secondary", id, values }) {
	const SummaryBadge = SUMMARY_BADGES[color];
	return (
		<SummaryBadge>
			<T id={id} data={values} />
		</SummaryBadge>
	);
}

// the summaries watch their own fields, so typing in one of them does not render the whole accordion
function RulesSummary({ isLocked }) {
	const watched = useWatch({ name: RULE_FIELDS });
	const rulesOn = watched.filter(Boolean).length;
	if (isLocked("disablePassword")) {
		return <Summary color="azure" id="settings.authentication.summary.password-locked" />;
	}
	if (rulesOn > 0) {
		return <Summary color="green" id="settings.authentication.summary.rules-on" values={{ count: rulesOn }} />;
	}
	return <Summary id="settings.authentication.summary.off" />;
}

function NewUsersSummary() {
	const [enabled, domains] = useWatch({ name: NEW_USER_FIELDS });
	if (!enabled) return <Summary id="settings.authentication.summary.off" />;
	return (
		<Summary
			color="green"
			id="settings.authentication.summary.new-users-on"
			values={{ count: parseDomains(domains).length }}
		/>
	);
}

const PERMISSION_FIELDS = ["autoCreatePermissions"];

// The rarely changed groups as collapsed cards; a refused save opens the one holding the error
function AuthGroups({ data, isLocked }) {
	return (
		<>
			<SettingsCard
				id="auth-rules"
				collapsible
				openOn={RULE_FIELDS}
				lines
				title={<T id="settings.authentication.rules" />}
				info={<T id="settings.authentication.rules.description" />}
				actions={<RulesSummary isLocked={isLocked} />}
			>
				<SignInRules data={data} isLocked={isLocked} />
			</SettingsCard>
			<SettingsCard
				id="auth-new-users"
				collapsible
				openOn={NEW_USER_FIELDS}
				lines
				title={<T id="settings.authentication.new-users" />}
				info={<T id="settings.authentication.new-users.description" />}
				actions={<NewUsersSummary />}
			>
				<NewUsersFields />
			</SettingsCard>
			<SettingsCard
				id="auth-permissions"
				collapsible
				openOn={PERMISSION_FIELDS}
				title={<T id="settings.authentication.default-permissions" />}
				info={<T id="settings.authentication.default-permissions.description" />}
			>
				<DefaultPermissionsFields />
			</SettingsCard>
		</>
	);
}

// field name -> label, for the note next to Save (the inputs' ids are prefixed, so it cannot find them by name)
const FIELD_LABELS = {
	issuerUrl: "settings.authentication.issuer-url",
	clientId: "settings.authentication.client-id",
	clientSecret: "settings.authentication.client-secret",
	redirectDomain: "settings.authentication.redirect-domain",
	scopes: "settings.authentication.scopes",
	disablePassword: "settings.authentication.disable-password",
	buttonLabel: "settings.authentication.button.label",
	buttonColor: "settings.authentication.button.color",
	autoCreateDomains: "settings.authentication.allowed-domains",
};

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch (new settings
 * replace every field); the secret field is emptied after a save, a saved secret is never shown
 */
function AuthenticationForm({ data }) {
	const { mutateAsync: save } = useSaveOidcSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	const errorRef = useRef(null);
	const locked = new Set((data.locked ?? []).map(camel));
	const isLocked = (key) => locked.has(key);
	const saved = authenticationValues(data);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		validate: authenticationValidate(validations, data, isLocked),
	});

	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await save(authenticationPayload(values, data));
			methods.setValue("clientSecret", "", { shouldDirty: true });
			showObjectSuccess("setting", "saved");
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="space-y-4">
			<Heading />
			<div ref={errorRef} tabIndex={-1} className="empty:hidden">
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
			</div>
			<SettingsLead id="settings.authentication.intro" />
			{data.active ? (
				<StatusAlert variant="success" icon={CircleCheck} id="settings.authentication.status.active" />
			) : (
				<StatusAlert variant="secondary" icon={CircleDashed} id="settings.authentication.status.inactive" />
			)}
			{data.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.authentication.status.secret-error" />
			) : null}
			{locked.size > 0 ? (
				<StatusAlert variant="info" icon={Lock} id="settings.authentication.status.locked" />
			) : null}
			<ProviderFields data={data} isLocked={isLocked} />
			<ButtonFields data={data} />
			<AuthGroups data={data} isLocked={isLocked} />
			<SaveBar labels={FIELD_LABELS} />
		</HookForm>
	);
}

export default function Authentication() {
	const { data, isPending, error } = useOidcSettings();

	return (
		<SettingsForm titleId="settings.authentication" error={error} isPending={isPending}>
			{() => <AuthenticationForm data={data} />}
		</SettingsForm>
	);
}
