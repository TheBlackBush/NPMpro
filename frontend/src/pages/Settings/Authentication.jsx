import { IconAlertCircle, IconCircleCheck, IconCircleDashed, IconInfoCircle } from "@tabler/icons-react";
import { Form, Formik, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, Loading } from "src/components";
import { useOidcSettings, useSaveOidcSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { camel, isOidcColor, oidcSettingsPayload } from "src/modules/Oidc";
import { showObjectSuccess } from "src/notifications";
import { ButtonFields } from "./Authentication/ButtonFields";
import { NewUsersFields } from "./Authentication/NewUsersFields";
import { ProviderFields } from "./Authentication/ProviderFields";
import { SignInRules } from "./Authentication/SignInRules";

function StatusAlert({ variant, icon: Icon, id }) {
	return (
		<div className={`alert alert-${variant}`} role="status">
			<div className="alert-icon">
				<Icon className="icon" aria-hidden="true" />
			</div>
			<div>
				<T id={id} />
			</div>
		</div>
	);
}

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
		<h3 className="card-title mb-3">
			<T id="settings.authentication" />
		</h3>
	);
}

const parseDomains = (text) =>
	text
		.split(",")
		.map((domain) => domain.trim().toLowerCase())
		.filter(Boolean);

const validate = (values) => {
	const errors = {};
	if (!isOidcColor(values.buttonColor)) {
		errors.buttonColor = intl.formatMessage({ id: "settings.authentication.button.color.invalid" });
	}
	if (!values.buttonLabel.trim()) {
		errors.buttonLabel = intl.formatMessage({ id: "settings.authentication.button.label.required" });
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
				buttonColor: data.button?.color ?? "",
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
					<SignInRules data={data} isLocked={isLocked} />
					<NewUsersFields />
				</div>
				<div className="card-footer text-end">
					<SaveButton />
				</div>
			</Form>
		</Formik>
	);
}
