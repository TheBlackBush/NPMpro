import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { createCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DNSProviderFields,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	HookForm,
	RequestProgress,
	SwitchField,
	SwitchList,
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { dnsCertificateValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const showDNSCertificateModal = () => {
	EasyModal.show(DNSCertificateModal);
};

const validate = dnsCertificateValidate(validations);
const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const DNSCertificateModal = EasyModal.create(({ visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({
		defaultValues: {
			domainNames: [],
			provider: "letsencrypt",
			npmproDnsChallenge: true,
			npmproDnsProvider: "",
			npmproDnsCredentialId: null,
			npmproPropagationSeconds: 0,
			npmproReuseKey: false,
		},
		validate,
	});
	const { isSubmitting } = methods.formState;
	const propagationSeconds = useWatch({ control: methods.control, name: "npmproPropagationSeconds" });

	const onSubmit = async (values) => {
		setErrorMsg(null);

		try {
			await createCertificate(values);
			showObjectSuccess("certificate", "saved");
			remove();
			await queryClient.invalidateQueries({ queryKey: ["certificates"] });
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="object.add" tData={{ object: "lets-encrypt-via-dns" }} />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
					<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
					<DNSProviderFields />
					<SwitchList className="mt-3">
						<SwitchField
							id="npmproReuseKey"
							label={<T id="domains.reuse-key" />}
							{...methods.register("npmproReuseKey")}
						/>
					</SwitchList>
					<RequestProgress running={isSubmitting} propagationSeconds={propagationSeconds} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showDNSCertificateModal };
