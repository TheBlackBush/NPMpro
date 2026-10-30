import { useState } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import Select from "react-select";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialValuesFields,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	NoticeAlert,
	useAppForm,
} from "src/components";
import {
	DirtyTracker,
	useDnsCredential,
	useDnsProviders,
	useSetDnsCredential,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import { credentialFieldValues, dnsCredentialValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { selectClassNames } from "src/modules/Select";
import { validations } from "src/modules/Validations";
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

const emptyCredential = { name: "", provider: "", useIni: false, fieldValues: {}, ini: "", oneOfGroup: "" };

// the provider select: another provider starts with its own empty fields, and the old fields' messages go
function ProviderSelect({ providers, options, locked }) {
	const { setValue, clearErrors } = useFormContext();
	const { field, fieldState } = useController({ name: "provider" });
	const providerError = fieldState.error?.message ?? null;
	return (
		<div className="mt-3">
			<label htmlFor="dnsCredentialProvider" className="form-label">
				<T id="certificates.dns.provider" />
			</label>
			<Select
				ref={field.ref}
				unstyled
				classNames={selectClassNames}
				name="provider"
				inputId="dnsCredentialProvider"
				aria-invalid={providerError ? "true" : undefined}
				aria-describedby={providerError ? "dnsCredentialProvider-error" : undefined}
				onBlur={field.onBlur}
				closeMenuOnSelect={true}
				isClearable={false}
				isDisabled={locked}
				placeholder={intl.formatMessage({
					id: "certificates.dns.provider.placeholder",
				})}
				isSearchable
				required
				value={options?.find((o) => o.value === field.value) ?? null}
				options={options}
				onChange={(newValue) => {
					const next = providers.find((p) => p.id === newValue?.value);
					field.onChange(newValue?.value);
					setValue("fieldValues", credentialFieldValues(next, null), { shouldDirty: true });
					setValue("ini", "", { shouldDirty: true });
					setValue("useIni", !next?.fields, { shouldDirty: true });
					setValue("oneOfGroup", defaultGroup(next, null), { shouldDirty: true });
					clearErrors(["fieldValues", "ini"]);
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
	);
}

// the values fields of the chosen provider, with the saved credential while it is its own provider
function CredentialValues({ providers, data }) {
	const providerId = useWatch({ name: "provider" });
	return (
		<DnsCredentialValuesFields
			provider={providers.find((p) => p.id === providerId)}
			credential={data.provider === providerId ? data : null}
		/>
	);
}

const DnsCredentialModal = EasyModal.create(({ id, provider: presetProvider, onSaved, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useDnsCredential(id);
	const { data: providers, isPending: providersPending } = useDnsProviders();
	const { mutateAsync: setDnsCredential } = useSetDnsCredential();
	const [errorMsg, setErrorMsg] = useState(null);

	const isNew = id === "new";
	// deprecated providers are not offered for new credentials, only kept for the one that already uses them
	const options = providers
		?.filter((p) => !p.deprecated || p.id === data?.provider)
		.map((p) => ({ value: p.id, label: p.name }));

	const initialValuesFor = (credential) => {
		const providerId = credential.provider || presetProvider || "";
		const provider = providers?.find((p) => p.id === providerId);
		return {
			name: credential.name ?? "",
			provider: providerId,
			useIni: !provider?.fields || Boolean(credential.iniSet),
			fieldValues: credentialFieldValues(provider, credential),
			ini: "",
			oneOfGroup: defaultGroup(provider, credential),
		};
	};

	const ready = data && providers;
	const methods = useAppForm({
		defaultValues: emptyCredential,
		values: ready ? initialValuesFor(data) : undefined,
		validate: (values) =>
			dnsCredentialValidate(validations, { providers: providers ?? [], credential: data })(values),
	});
	const {
		register,
		formState: { errors, isSubmitting },
	} = methods;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		const provider = providers?.find((p) => p.id === values.provider);
		try {
			const row = await setDnsCredential(toPayload(values, id, provider));
			onSaved?.(row);
			showObjectSuccess("dns-credential", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	const locked = !isNew && (data?.certificates?.length ?? 0) > 0;

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || providersPending) && <Loading noLogo />}
			{ready && (
				<HookForm methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title>
							<T id={isNew ? "object.add" : "object.edit"} tData={{ object: "dns-credential" }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						{data.decryptError ? (
							<NoticeAlert>
								<T id="dns-credentials.decrypt-error" />
							</NoticeAlert>
						) : null}
						<div>
							<label htmlFor="dnsCredentialName" className="form-label">
								<T id="dns-credentials.name" />
							</label>
							<input
								id="dnsCredentialName"
								type="text"
								required
								autoComplete="off"
								className={`form-control ${errors.name ? "is-invalid" : ""}`}
								{...register("name")}
							/>
							{errors.name ? <div className="invalid-feedback">{errors.name.message}</div> : null}
						</div>
						<ProviderSelect providers={providers} options={options} locked={locked} />
						<CredentialValues providers={providers} data={data} />
					</AppModal.Body>
					<AppModal.Footer>
						<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							<FormSubmit
								className="ms-auto"
								edit={!isNew}
								section="dnsCredentials"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</FormSubmit>
						</HasPermission>
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showDnsCredentialModal };
