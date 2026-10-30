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

const SUMMARY_FIELDS = ["requireVerifiedEmail", "skipMfa", "disablePassword", "autoCreateEnabled", "autoCreateDomains"];

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

// Collapsible groups below the always visible provider and button settings. A group holding a validation error is
// opened by a refused save (while rendering, so it is open when the first error gets the focus), so an error is never
// hidden.
function AuthAccordion({ data, isLocked }) {
	const { errors, submitCount } = useFormState();
	const [openKeys, setOpenKeys] = useState([]);
	const [seenSubmits, setSeenSubmits] = useState(submitCount);
	if (submitCount !== seenSubmits) {
		setSeenSubmits(submitCount);
		if (errors.autoCreateDomains && !openKeys.includes("new-users")) setOpenKeys([...openKeys, "new-users"]);
	}
	const watched = useWatch({ name: SUMMARY_FIELDS });
	const values = Object.fromEntries(SUMMARY_FIELDS.map((name, index) => [name, watched[index]]));

	const rulesOn = ["requireVerifiedEmail", "skipMfa", "disablePassword"].filter((name) => values[name]).length;
	let rulesSummary = <Summary id="settings.authentication.summary.off" />;
	if (isLocked("disablePassword")) {
		rulesSummary = <Summary color="azure" id="settings.authentication.summary.password-locked" />;
	} else if (rulesOn > 0) {
		rulesSummary = (
			<Summary color="green" id="settings.authentication.summary.rules-on" values={{ count: rulesOn }} />
		);
	}

	const domainCount = parseDomains(values.autoCreateDomains).length;
	const newUsersSummary = values.autoCreateEnabled ? (
		<Summary color="green" id="settings.authentication.summary.new-users-on" values={{ count: domainCount }} />
	) : (
		<Summary id="settings.authentication.summary.off" />
	);

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
				rulesSummary,
				<SignInRules data={data} isLocked={isLocked} />,
			)}
			{item("new-users", "settings.authentication.new-users", newUsersSummary, <NewUsersFields />)}
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
