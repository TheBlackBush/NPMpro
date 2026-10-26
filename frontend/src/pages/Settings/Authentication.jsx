import { IconAlertCircle, IconCircleCheck, IconCircleDashed, IconInfoCircle } from "@tabler/icons-react";
import { Form, Formik, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { Accordion } from "react-bootstrap";
import { ApiErrorContent, Button, ErrorAlert, FormErrorNote, Loading } from "src/components";
import { LeaveGuard, useOidcSettings, useSaveOidcSettings } from "src/hooks";
import { intl, T } from "src/locale";
import {
	camel,
	DEFAULT_OIDC_COLOR,
	isOidcColor,
	isOidcDomain,
	OIDC_MAX_DOMAINS,
	oidcSettingsPayload,
	parseDomains,
} from "src/modules/Oidc";
import { showObjectSuccess } from "src/notifications";
import { ButtonFields } from "./Authentication/ButtonFields";
import { DefaultPermissionsFields, NewUsersFields } from "./Authentication/NewUsersFields";
import { ProviderFields } from "./Authentication/ProviderFields";
import { SignInRules } from "./Authentication/SignInRules";
import { StatusAlert } from "./StatusAlert";

function SaveButton() {
	const { isSubmitting } = useFormikContext();
	return (
		<Button type="submit" color="teal" isLoading={isSubmitting} disabled={isSubmitting}>
			<T id="save" />
		</Button>
	);
}

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
// opened after a submit, so an error is never hidden.
function AuthAccordion({ data, isLocked }) {
	const { values, errors, submitCount } = useFormikContext();
	const [openKeys, setOpenKeys] = useState([]);
	const hasDomainsError = Boolean(errors.autoCreateDomains);

	useEffect(() => {
		if (submitCount > 0 && hasDomainsError) {
			setOpenKeys((keys) => (keys.includes("new-users") ? keys : [...keys, "new-users"]));
		}
	}, [submitCount, hasDomainsError]);

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

const validate = (values) => {
	const errors = {};
	if (!isOidcColor(values.buttonColor)) {
		errors.buttonColor = intl.formatMessage({ id: "settings.authentication.button.color.invalid" });
	}
	if (!values.buttonLabel.trim()) {
		errors.buttonLabel = intl.formatMessage({ id: "settings.authentication.button.label.required" });
	}
	const domains = parseDomains(values.autoCreateDomains);
	const invalid = domains.filter((domain) => !isOidcDomain(domain));
	if (invalid.length > 0) {
		errors.autoCreateDomains = intl.formatMessage(
			{ id: "settings.authentication.allowed-domains.invalid" },
			{ domains: invalid.join(", ") },
		);
	} else if (domains.length > OIDC_MAX_DOMAINS) {
		errors.autoCreateDomains = intl.formatMessage(
			{ id: "settings.authentication.allowed-domains.too-many" },
			{ max: OIDC_MAX_DOMAINS },
		);
	}
	return errors;
};

export default function Authentication() {
	const { data, isPending, error } = useOidcSettings();
	const { mutate: save } = useSaveOidcSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	const errorRef = useRef(null);

	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);

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

	const locked = new Set((data.locked ?? []).map(camel));
	const isLocked = (key) => locked.has(key);

	const onSubmit = (values, { setSubmitting, setFieldValue }) => {
		setErrorMsg(null);
		const {
			buttonLabel,
			buttonColor,
			buttonIcon,
			autoCreateEnabled,
			autoCreateDomains,
			autoCreatePermissions,
			...rest
		} = values;
		const button = {
			label: buttonLabel.trim(),
			color: buttonColor,
			icon: buttonIcon ? { type: "builtin", name: buttonIcon } : data.button?.icon,
		};
		const autoCreate = {
			enabled: autoCreateEnabled,
			allowedDomains: parseDomains(autoCreateDomains),
			permissions: autoCreatePermissions,
		};
		save(oidcSettingsPayload({ ...data, ...rest, autoCreate, button }), {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: () => {
				setFieldValue("clientSecret", "");
				showObjectSuccess("setting", "saved");
			},
			onSettled: () => {
				setSubmitting(false);
			},
		});
	};

	return (
		<Formik
			enableReinitialize
			initialValues={{
				enabled: data.enabled,
				issuerUrl: data.issuerUrl ?? "",
				clientId: data.clientId ?? "",
				clientSecret: "",
				redirectDomain: data.redirectDomain ?? "",
				scopes: data.scopes ?? "",
				requireVerifiedEmail: data.requireVerifiedEmail,
				skipMfa: data.skipMfa,
				disablePassword: data.disablePassword,
				autoCreateEnabled: Boolean(data.autoCreate?.enabled),
				autoCreateDomains: (data.autoCreate?.allowedDomains ?? []).join(", "),
				autoCreatePermissions: {
					visibility: data.autoCreate?.permissions?.visibility ?? "user",
					proxyHosts: data.autoCreate?.permissions?.proxyHosts ?? "view",
					redirectionHosts: data.autoCreate?.permissions?.redirectionHosts ?? "view",
					deadHosts: data.autoCreate?.permissions?.deadHosts ?? "view",
					streams: data.autoCreate?.permissions?.streams ?? "view",
					accessLists: data.autoCreate?.permissions?.accessLists ?? "view",
					certificates: data.autoCreate?.permissions?.certificates ?? "view",
				},
				buttonLabel: data.button?.label ?? "",
				buttonColor: data.button?.color || DEFAULT_OIDC_COLOR,
				// a built-in icon picked but not saved yet; null keeps the stored icon (uploads save on their own)
				buttonIcon: null,
			}}
			validate={validate}
			onSubmit={onSubmit}
		>
			<Form className="d-flex flex-column flex-fill">
				<div className="card-body flex-fill">
					<Heading />
					<div ref={errorRef} tabIndex={-1}>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					</div>
					{data.active ? (
						<StatusAlert
							variant="success"
							icon={IconCircleCheck}
							id="settings.authentication.status.active"
						/>
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
				<div className="card-footer text-end">
					<LeaveGuard />
					<FormErrorNote className="me-3" />
					<SaveButton />
				</div>
			</Form>
		</Formik>
	);
}
