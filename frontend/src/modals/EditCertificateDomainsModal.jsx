import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { setCertificateDomains } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	HookForm,
	NoticeAlert,
	RequestProgress,
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { sameNames, uncoveredHosts, uncoveredNames } from "src/modules/CertificateDomains";
import { acmeDomainsValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const showEditCertificateDomainsModal = (certificate) => {
	EasyModal.show(EditCertificateDomainsModal, { certificate });
};

const accent = sectionAccent("certificates");
const Icon = sectionIcon("certificates");

const EditCertificateDomainsModal = EasyModal.create(({ certificate, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const dnsChallenge = Boolean(certificate.npmproDnsChallenge);
	const methods = useAppForm({
		defaultValues: { domainNames: certificate.domainNames },
		validate: acmeDomainsValidate(validations, { dnsChallenge }),
	});
	const { isSubmitting } = methods.formState;
	const names = useWatch({ control: methods.control, name: "domainNames" });
	const uncovered = uncoveredHosts(names ?? [], certificate);
	const unchanged = sameNames(names ?? [], certificate.domainNames);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await setCertificateDomains(certificate.id, values.domainNames);
			showObjectSuccess("certificate", "updated");
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["certificates"] }),
				queryClient.invalidateQueries({ queryKey: ["certificate", certificate.id] }),
			]);
			remove();
		} catch (err) {
			// the window stays open: a failed request leaves the certificate and its hosts as they were
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static" data-edit-domains="">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
						<T id="certificate.edit-domains" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<p className="mb-3 text-muted-foreground">
						<T id="certificate.edit-domains.note" />
					</p>
					<DomainNamesField isWildcardPermitted={dnsChallenge} dnsProviderWildcardSupported forCertificate />
					{uncovered.length > 0 ? (
						<div data-uncovered-hosts="">
							<NoticeAlert className="mt-3">
								<T
									id="certificate.edit-domains.uncovered"
									data={{ names: uncoveredNames(uncovered).join(", ") }}
								/>
							</NoticeAlert>
						</div>
					) : null}
					<RequestProgress running={isSubmitting} propagationSeconds={certificate.npmproPropagationSeconds} />
					<ErrorAlert className="mt-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit isLoading={isSubmitting} disabled={isSubmitting || unchanged}>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showEditCertificateDomainsModal };
