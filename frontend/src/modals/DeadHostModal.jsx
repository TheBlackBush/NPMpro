import { useWatch } from "react-hook-form";
import {
	DirectoryField,
	DomainNamesField,
	ModalTabs,
	NginxConfigField,
	SSLCertificateField,
	SSLOptionsFields,
	TabPane,
} from "src/components";
import { useDeadHost, useSetDeadHost } from "src/hooks";
import {
	DEAD_HOST_TABS,
	deadHostDefaults,
	deadHostValidate,
	domainNamesOptions,
	requestValues,
} from "src/modules/HostForms";
import { DEAD_HOSTS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { createHostEditorModal } from "./HostEditorModal";

function DeadHostFields() {
	const [certificateId, npmproDnsChallenge, advancedConfig] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig"],
	});
	return (
		<ModalTabs tabs={DEAD_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
			<TabPane id="details">
				<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
				<DirectoryField labelId="dead-host.directory" className="mb-0" />
			</TabPane>
			<TabPane id="tls">
				<SSLCertificateField label="ssl-certificate" allowNew />

				<SSLOptionsFields />
			</TabPane>
			{/* the config fields are read-only in a View window themselves, so they can still be focused and scrolled */}
			<TabPane id="advanced" selfReadOnly>
				<NginxConfigField label="nginx-config.server.label" hint="nginx-config.server.hint" />
			</TabPane>
		</ModalTabs>
	);
}

const showDeadHostModal = createHostEditorModal({
	object: "dead-host",
	section: DEAD_HOSTS,
	useHost: useDeadHost,
	useSave: useSetDeadHost,
	defaults: deadHostDefaults,
	validate: deadHostValidate(validations),
	payload: requestValues,
	Fields: DeadHostFields,
});

export { showDeadHostModal };
