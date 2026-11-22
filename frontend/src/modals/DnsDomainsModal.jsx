import { useState } from "react";
import { useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialSelect,
	DnsDomainNamesField,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	useAppForm,
} from "src/components";
import { DirtyTracker, useCreateDnsDomains, useDnsCredentials, useDnsDomains, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { dnsDomainNamesRule, takenNames } from "src/modules/DnsDomainForms";
import EasyModal from "src/modules/easyModal";
import { fieldsValidate } from "src/modules/HookForm";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");
const EXPAND = ["credential"];

/**
 * The Add domains window: one credential and the names it manages (the backend adds all or none). Opened from the
 * Domains tab, or from a credential (credentialId preset).
 */
const showDnsDomainsModal = ({ credentialId } = {}) => {
	EasyModal.show(DnsDomainsModal, { credentialId });
};

// the owner of the chosen credential: the names are checked against what that owner keeps elsewhere
function DomainNames({ credentials }) {
	const credentialId = useWatch({ name: "dnsCredentialId" });
	const ownerUserId = credentials?.find((c) => c.id === credentialId)?.ownerUserId;
	return <DnsDomainNamesField credentialId={credentialId ?? null} ownerUserId={ownerUserId} />;
}

const DnsDomainsModal = EasyModal.create(({ credentialId, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { mutateAsync: createDnsDomains } = useCreateDnsDomains();
	const { data: credentials } = useDnsCredentials();
	const { data: domains } = useDnsDomains(EXPAND);
	const [errorMsg, setErrorMsg] = useState(null);

	const methods = useAppForm({
		defaultValues: { dnsCredentialId: credentialId ?? undefined, domains: [] },
		validate: fieldsValidate((values) => {
			const ownerUserId = credentials?.find((c) => c.id === values.dnsCredentialId)?.ownerUserId;
			const taken = takenNames(values.domains, {
				credentialId: values.dnsCredentialId ?? null,
				ownerUserId,
				domains,
			});
			const namesRule = dnsDomainNamesRule(validations, taken);
			return {
				dnsCredentialId: validations.validateRequired(),
				domains: (value) => validations.validateRequired()(value) ?? namesRule(value),
			};
		}),
	});
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await createDnsDomains({ dnsCredentialId: values.dnsCredentialId, names: values.domains });
			showObjectSuccess("dns-domain", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static" data-dns-domains-window>
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="dns-domains.add" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					<DnsCredentialSelect name="dnsCredentialId" />
					<DomainNames credentials={credentials} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
						<FormSubmit isLoading={isSubmitting} disabled={isSubmitting}>
							<T id="save" />
						</FormSubmit>
					</HasPermission>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showDnsDomainsModal };
