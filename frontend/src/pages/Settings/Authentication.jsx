import { IconAlertCircle, IconCircleCheck, IconCircleDashed, IconInfoCircle } from "@tabler/icons-react";
import { Form, Formik, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, Loading } from "src/components";
import { useOidcSettings, useSaveOidcSettings } from "src/hooks";
import { T } from "src/locale";
import { camel, oidcSettingsPayload } from "src/modules/Oidc";
import { showObjectSuccess } from "src/notifications";
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
		save(oidcSettingsPayload({ ...data, ...values }), {
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
			}}
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
					{/* Login button section (Task 10) goes here */}
					<SignInRules data={data} isLocked={isLocked} />
					{/* New users section (Task 11) goes here */}
				</div>
				<div className="card-footer text-end">
					<SaveButton />
				</div>
			</Form>
		</Formik>
	);
}
