import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialSelect,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	useAppForm,
} from "src/components";
import { DirtyTracker, useCanManage, useDnsDomains, useMoveDnsDomain, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { fieldsValidate } from "src/modules/HookForm";
import { windowTitleId } from "src/modules/HostForms";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const accent = sectionAccent("dnsCredentials");
const Icon = sectionIcon("certificates");
const EXPAND = ["credential"];

/** The Edit window of one DNS domain: it moves to another credential of the same owner (a View window without manage) */
const showDnsDomainModal = (id) => {
	EasyModal.show(DnsDomainModal, { id });
};

const DnsDomainModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const readOnly = !useCanManage(CERTIFICATES);
	const { data: domains, isPending } = useDnsDomains(EXPAND);
	const { mutateAsync: moveDnsDomain } = useMoveDnsDomain();
	const [errorMsg, setErrorMsg] = useState(null);

	const domain = domains?.find((d) => d.id === id);
	const methods = useAppForm({
		defaultValues: { dnsCredentialId: undefined },
		values: domain ? { dnsCredentialId: domain.dnsCredentialId } : undefined,
		validate: fieldsValidate({ dnsCredentialId: validations.validateRequired() }),
	});
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await moveDnsDomain({ id, dnsCredentialId: values.dnsCredentialId });
			showObjectSuccess("dns-domain", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static" data-dns-domain-window>
			{isPending && <Loading noLogo />}
			{domain && (
				<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title className="flex items-center gap-2">
							{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
							<T id={windowTitleId({ editing: true, readOnly })} tData={{ object: "dns-domain" }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						{/* a View window: the fields sit in a disabled fieldset */}
						<fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
							<div className="mb-3 flex flex-col gap-1">
								<span className="font-medium text-sm">
									<T id="dns-domain" />
								</span>
								<span className="wrap-anywhere text-sm" data-dns-domain-name>
									{domain.name}
								</span>
							</div>
							<DnsCredentialSelect
								name="dnsCredentialId"
								ownerUserId={domain.credential?.ownerUserId}
								hint={<T id="dns-domains.move.hint" />}
							/>
						</fieldset>
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={close} disabled={isSubmitting}>
							<T id={readOnly ? "action.close" : "cancel"} />
						</Button>
						<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
							<FormSubmit edit isLoading={isSubmitting} disabled={isSubmitting}>
								<T id="save" />
							</FormSubmit>
						</HasPermission>
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showDnsDomainModal };
