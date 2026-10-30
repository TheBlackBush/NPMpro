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
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import { dnsCertificateValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showDNSCertificateModal = () => {
	EasyModal.show(DNSCertificateModal);
};

const validate = dnsCertificateValidate(validations);

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
					<AppModal.Title>
						<T id="object.add" tData={{ object: "lets-encrypt-via-dns" }} />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
					<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
					<DNSProviderFields />
					<div className="divide-y">
						<SwitchField
							id="npmproReuseKey"
							label={<T id="domains.reuse-key" />}
							{...methods.register("npmproReuseKey")}
						/>
					</div>
					<RequestProgress running={isSubmitting} propagationSeconds={propagationSeconds} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit
						className="ms-auto"
						section="certificates"
						isLoading={isSubmitting}
						disabled={isSubmitting}
					>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showDNSCertificateModal };
