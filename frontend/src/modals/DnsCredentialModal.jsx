import { useState } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	Combobox,
	DnsCredentialValuesFields,
	ErrorAlert,
	FormField,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	NoticeAlert,
	TextField,
	useAppForm,
	useReadOnly,
} from "src/components";
import {
	DirtyTracker,
	useCanManage,
	useDnsCredential,
	useDnsProviders,
	useSetDnsCredential,
	useUnsavedChangesGuard,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { credentialFieldValues, dnsCredentialValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { windowTitleId } from "src/modules/HostForms";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

// DNS credentials has no menu link of its own: the certificates icon in the DNS credentials accent
const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");

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
	const readOnly = useReadOnly();
	return (
		<FormField
			id="dnsCredentialProvider"
			label={<T id="certificates.dns.provider" />}
			required
			hint={locked ? <T id="dns-credentials.provider-locked" /> : undefined}
			error={fieldState.error?.message ?? null}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name="provider"
					onBlur={field.onBlur}
					disabled={locked || readOnly}
					placeholder={intl.formatMessage({
						id: "certificates.dns.provider.placeholder",
					})}
					value={options?.some((o) => o.value === field.value) ? field.value : null}
					options={options ?? []}
					onChange={(value) => {
						const next = providers.find((p) => p.id === value);
						// not clearable: value is always a provider of the list
						field.onChange(value);
						setValue("fieldValues", credentialFieldValues(next, null), { shouldDirty: true });
						setValue("ini", "", { shouldDirty: true });
						setValue("useIni", !next?.fields, { shouldDirty: true });
						setValue("oneOfGroup", defaultGroup(next, null), { shouldDirty: true });
						clearErrors(["fieldValues", "ini"]);
					}}
				/>
			)}
		</FormField>
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
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(CERTIFICATES);
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
	const { isSubmitting } = methods.formState;

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
				<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title className="flex items-center gap-2">
							{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
							<T id={windowTitleId({ editing: !isNew, readOnly })} tData={{ object: "dns-credential" }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						{data.decryptError ? (
							<NoticeAlert>
								<T id="dns-credentials.decrypt-error" />
							</NoticeAlert>
						) : null}
						{/* a View window: the fields sit in a disabled fieldset */}
						<fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
							<TextField
								name="name"
								id="dnsCredentialName"
								label={<T id="dns-credentials.name" />}
								autoComplete="off"
								required
							/>
							<ProviderSelect providers={providers} options={options} locked={locked} />
							<CredentialValues providers={providers} data={data} />
						</fieldset>
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={close} disabled={isSubmitting}>
							<T id={readOnly ? "action.close" : "cancel"} />
						</Button>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							<FormSubmit edit={!isNew} isLoading={isSubmitting} disabled={isSubmitting}>
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
