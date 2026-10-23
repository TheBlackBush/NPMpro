import { Field, Form, Formik } from "formik";
import { useState } from "react";
import Modal from "react-bootstrap/Modal";
import Select from "react-select";
import {
	ApiErrorContent,
	Button,
	DnsCredentialValuesFields,
	ErrorAlert,
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

const DnsCredentialModal = EasyModal.create(({ id, provider: presetProvider, onSaved, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useDnsCredential(id);
	const { data: providers, isPending: providersPending } = useDnsProviders();
	const { mutate: setDnsCredential } = useSetDnsCredential();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isNew = id === "new";
	const options = providers?.map((p) => ({ value: p.id, label: p.name }));

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
		<Modal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || providersPending) && <Loading noLogo />}
			{ready && (
				<Formik initialValues={initialValuesFor(data)} onSubmit={onSubmit}>
					{({ values, setFieldValue }) => {
						const provider = providers.find((p) => p.id === values.provider);
						const locked = !isNew && (data.certificates?.length ?? 0) > 0;
						return (
							<Form>
								<DirtyTracker dirtyRef={dirtyRef} />
								<Modal.Header closeButton={!isSubmitting}>
									<Modal.Title>
										<T
											id={isNew ? "object.add" : "object.edit"}
											tData={{ object: "dns-credential" }}
										/>
									</Modal.Title>
								</Modal.Header>
								<Modal.Body>
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
													className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
													{...field}
												/>
												{form.errors.name ? (
													<div className="invalid-feedback">
														{form.touched.name ? form.errors.name : null}
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
											inputId="dnsCredentialProvider"
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
								</Modal.Body>
								<Modal.Footer>
									<Button onClick={close} disabled={isSubmitting}>
										<T id="cancel" />
									</Button>
									<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
										<Button
											type="submit"
											color="pink"
											className="ms-auto"
											isLoading={isSubmitting}
											disabled={isSubmitting}
										>
											<T id="save" />
										</Button>
									</HasPermission>
								</Modal.Footer>
							</Form>
						);
					}}
				</Formik>
			)}
		</Modal>
	);
});

export { showDnsCredentialModal };
