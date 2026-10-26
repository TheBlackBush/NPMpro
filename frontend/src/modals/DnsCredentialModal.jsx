import { Field, Form, Formik } from "formik";
import { useState } from "react";
import Select from "react-select";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialValuesFields,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	Loading,
	NoticeAlert,
} from "src/components";
import {
	DirtyTracker,
	useDnsCredential,
	useDnsProviders,
	useSetDnsCredential,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { selectClassNames } from "src/modules/Select";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showDnsCredentialModal = (id, options = {}) => {
	EasyModal.show(DnsCredentialModal, { id, ...options });
};

const defaultGroup = (provider, credential) => {
	if (!provider?.oneOf?.length) {
		return "";
	}
	const saved = (credential?.fields ?? []).find((f) => f.isSet || f.value);
	const group = provider.fields?.find((f) => f.key === saved?.key)?.group;
	return group || provider.oneOf[0];
};

const toPayload = (values, id, provider) => {
	const base = { id: id === "new" ? undefined : id, name: values.name, provider: values.provider };
	if (!provider?.fields || values.useIni) return { ...base, ini: values.ini };
	const activeGroup = provider.oneOf ? values.oneOfGroup : null;
	const fields = provider.fields
		.filter((field) => !field.group || field.group === activeGroup)
		.map((field) => ({ key: field.key, value: values.fieldValues[field.key] ?? "" }));
	return { ...base, fields };
};

const validateProvider = (values) =>
	values.provider ? {} : { provider: intl.formatMessage({ id: "error.required" }) };

const DnsCredentialModal = EasyModal.create(({ id, provider: presetProvider, onSaved, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useDnsCredential(id);
	const { data: providers, isPending: providersPending } = useDnsProviders();
	const { mutate: setDnsCredential } = useSetDnsCredential();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isNew = id === "new";
	// deprecated providers are not offered for new credentials, only kept for the one that already uses them
	const options = providers
		?.filter((p) => !p.deprecated || p.id === data?.provider)
		.map((p) => ({ value: p.id, label: p.name }));

	const onSubmit = (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const provider = providers?.find((p) => p.id === values.provider);
		setDnsCredential(toPayload(values, id, provider), {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: (row) => {
				onSaved?.(row);
				showObjectSuccess("dns-credential", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	const initialValuesFor = (credential) => {
		const providerId = credential.provider || presetProvider || "";
		const provider = providers?.find((p) => p.id === providerId);
		const fieldValues = {};
		for (const f of credential.fields ?? []) {
			if (f.value !== undefined && f.value !== null) {
				fieldValues[f.key] = f.value;
			}
		}
		return {
			name: credential.name ?? "",
			provider: providerId,
			useIni: !provider?.fields || Boolean(credential.iniSet),
			fieldValues,
			ini: "",
			oneOfGroup: defaultGroup(provider, credential),
		};
	};

	const ready = data && providers;

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || providersPending) && <Loading noLogo />}
			{ready && (
				<Formik initialValues={initialValuesFor(data)} validate={validateProvider} onSubmit={onSubmit}>
					{({ values, setFieldValue, setFieldTouched, errors, touched, submitCount }) => {
						const providerError =
							errors.provider && (touched.provider || submitCount > 0) ? errors.provider : null;
						const provider = providers.find((p) => p.id === values.provider);
						const locked = !isNew && (data.certificates?.length ?? 0) > 0;
						return (
							<Form noValidate>
								<DirtyTracker dirtyRef={dirtyRef} />
								<AppModal.Header closeButton={!isSubmitting}>
									<AppModal.Title>
										<T
											id={isNew ? "object.add" : "object.edit"}
											tData={{ object: "dns-credential" }}
										/>
									</AppModal.Title>
								</AppModal.Header>
								<AppModal.Body>
									<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
									{data.decryptError ? (
										<NoticeAlert>
											<T id="dns-credentials.decrypt-error" />
										</NoticeAlert>
									) : null}
									<Field name="name" validate={validateString(1, 255)}>
										{({ field, form }) => (
											<div>
												<label htmlFor="dnsCredentialName" className="form-label">
													<T id="dns-credentials.name" />
												</label>
												<input
													id="dnsCredentialName"
													type="text"
													required
													autoComplete="off"
													className={`form-control ${form.errors.name && (form.touched.name || form.submitCount > 0) ? "is-invalid" : ""}`}
													{...field}
												/>
												{form.errors.name ? (
													<div className="invalid-feedback">
														{form.touched.name || form.submitCount > 0
															? form.errors.name
															: null}
													</div>
												) : null}
											</div>
										)}
									</Field>
									<div className="mt-3">
										<label htmlFor="dnsCredentialProvider" className="form-label">
											<T id="certificates.dns.provider" />
										</label>
										<Select
											unstyled
											classNames={selectClassNames}
											name="provider"
											inputId="dnsCredentialProvider"
											aria-invalid={providerError ? "true" : undefined}
											aria-describedby={providerError ? "dnsCredentialProvider-error" : undefined}
											onBlur={() => setFieldTouched("provider", true)}
											closeMenuOnSelect={true}
											isClearable={false}
											isDisabled={locked}
											placeholder={intl.formatMessage({
												id: "certificates.dns.provider.placeholder",
											})}
											isSearchable
											required
											value={options?.find((o) => o.value === values.provider) ?? null}
											options={options}
											onChange={(newValue) => {
												const next = providers.find((p) => p.id === newValue?.value);
												void setFieldValue("provider", newValue?.value);
												void setFieldValue("fieldValues", {});
												void setFieldValue("ini", "");
												void setFieldValue("useIni", !next?.fields);
												void setFieldValue("oneOfGroup", defaultGroup(next, null));
											}}
										/>
										{providerError ? (
											<div className="invalid-feedback d-block" id="dnsCredentialProvider-error">
												{providerError}
											</div>
										) : null}
										{locked ? (
											<small className="text-secondary">
												<T id="dns-credentials.provider-locked" />
											</small>
										) : null}
									</div>
									<DnsCredentialValuesFields
										provider={provider}
										credential={data.provider === values.provider ? data : null}
									/>
								</AppModal.Body>
								<AppModal.Footer>
									<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
										<T id="cancel" />
									</Button>
									<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
										<FormSubmit
											className="ms-auto"
											edit={!isNew}
											color="primary"
											isLoading={isSubmitting}
											disabled={isSubmitting}
										>
											<T id="save" />
										</FormSubmit>
									</HasPermission>
								</AppModal.Footer>
							</Form>
						);
					}}
				</Formik>
			)}
		</AppModal>
	);
});

export { showDnsCredentialModal };
