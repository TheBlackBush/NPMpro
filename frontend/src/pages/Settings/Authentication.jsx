import { IconAlertCircle, IconCircleCheck, IconCircleDashed, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Accordion } from "react-bootstrap";
import { useFormState, useWatch } from "react-hook-form";
import { ApiErrorContent, ErrorAlert, HookForm, Loading, useAppForm } from "src/components";
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
import { StatusAlert } from "./StatusAlert";

const RULE_FIELDS = ["requireVerifiedEmail", "skipMfa", "disablePassword"];
const NEW_USER_FIELDS = ["autoCreateEnabled", "autoCreateDomains"];

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.authentication" />
		</h2>
	);
}

function Summary({ color = "secondary", id, values }) {
	return (
		<span className={`badge bg-${color}-lt fw-normal`}>
			<T id={id} data={values} />
		</span>
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

// Collapsible groups below the always visible provider and button settings. A group holding a validation error is
// opened by a refused save (while rendering, so it is open when the first error gets the focus), so an error is never
// hidden.
function AuthAccordion({ data, isLocked }) {
	const { errors, submitCount } = useFormState({ name: "autoCreateDomains" });
	const [openKeys, setOpenKeys] = useState([]);
	const [seenSubmits, setSeenSubmits] = useState(submitCount);
	if (submitCount !== seenSubmits) {
		setSeenSubmits(submitCount);
		if (errors.autoCreateDomains && !openKeys.includes("new-users")) setOpenKeys([...openKeys, "new-users"]);
	}
	const item = (eventKey, titleId, summary, children) => (
		<Accordion.Item eventKey={eventKey}>
			<Accordion.Header className="fs-3">
				<span className="d-flex flex-fill flex-wrap align-items-center justify-content-between gap-2 me-2">
					<span>
						<T id={titleId} />
					</span>
					{summary}
				</span>
			</Accordion.Header>
			<Accordion.Body>{children}</Accordion.Body>
		</Accordion.Item>
	);

	return (
		<Accordion alwaysOpen activeKey={openKeys} onSelect={(keys) => setOpenKeys(keys ?? [])}>
			{item(
				"rules",
				"settings.authentication.rules",
				<RulesSummary isLocked={isLocked} />,
				<SignInRules data={data} isLocked={isLocked} />,
			)}
			{item("new-users", "settings.authentication.new-users", <NewUsersSummary />, <NewUsersFields />)}
			{item("permissions", "settings.authentication.default-permissions", null, <DefaultPermissionsFields />)}
		</Accordion>
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
		<HookForm methods={methods} onSubmit={onSubmit} className="d-flex flex-column flex-fill">
			<div className="card-body flex-fill">
				<Heading />
				<div ref={errorRef} tabIndex={-1}>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
				</div>
				{data.active ? (
					<StatusAlert variant="success" icon={IconCircleCheck} id="settings.authentication.status.active" />
				) : (
					<StatusAlert
						variant="secondary"
						icon={IconCircleDashed}
						id="settings.authentication.status.inactive"
					/>
				)}
				{data.secretError ? (
					<StatusAlert
						variant="danger"
						icon={IconAlertCircle}
						id="settings.authentication.status.secret-error"
					/>
				) : null}
				{locked.size > 0 ? (
					<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
				) : null}
				<ProviderFields data={data} isLocked={isLocked} />
				<ButtonFields data={data} />
				<AuthAccordion data={data} isLocked={isLocked} />
			</div>
			<SaveBar labels={FIELD_LABELS} />
		</HookForm>
	);
}

export default function Authentication() {
	const { data, isPending, error } = useOidcSettings();

	if (error) {
		return (
			<div className="card-body">
				<Heading />
				<ErrorAlert error={error} />
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="card-body">
				<Heading />
				<Loading noLogo />
			</div>
		);
	}

	return <AuthenticationForm data={data} />;
}
