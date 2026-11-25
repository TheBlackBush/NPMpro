import { useWatch } from "react-hook-form";
import {
	DirectoryField,
	DomainNamesField,
	HostDnsCard,
	ModalTabs,
	NginxConfigField,
	PageChoiceField,
	PageLines,
	ReadOnlyFields,
	SSLCertificateField,
	SSLOptionsFields,
	TabPane,
	TagsField,
	TextField,
} from "src/components";
import { useDeadHost, useSetDeadHost } from "src/hooks";
import { intl, T } from "src/locale";
import {
	DEAD_HOST_TABS,
	deadHostDefaults,
	deadHostPayload,
	deadHostValidate,
	domainNamesOptions,
} from "src/modules/HostForms";
import { PLACE_FIELDS, previewPath } from "src/modules/LandingPageForms";
import { DEAD_HOSTS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { createHostEditorModal } from "./HostEditorModal";

function DeadHostFields({ isAdmin, hostId }) {
	const [certificateId, npmproDnsChallenge, advancedConfig] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig"],
	});
	return (
		<ModalTabs tabs={DEAD_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
			<TabPane id="details" selfReadOnly>
				<ReadOnlyFields>
					<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
				</ReadOnlyFields>
				<HostDnsCard type="dead" hostId={hostId} />
				<ReadOnlyFields>
					<TextField
						name="npmproDescription"
						label={<T id="host.description" />}
						type="text"
						maxLength={255}
						placeholder={intl.formatMessage({ id: "host.description.placeholder" })}
					/>
					<div className="mb-3 grid items-start gap-3 sm:grid-cols-2">
						<DirectoryField className="mb-0" labelId="dead-host.directory" />
						<TagsField className="mb-0" />
					</div>
					<PageLines className="mt-4">
						<PageChoiceField
							name="npmproPage"
							htmlName="npmproPageHtml"
							title={<T id="landing-pages.field.page" />}
							codes={PLACE_FIELDS.deadHost[0].codes}
							choices={PLACE_FIELDS.deadHost[0].choices}
							field={PLACE_FIELDS.deadHost[0]}
							previewHref={isAdmin && hostId ? previewPath({ source: "dead-host", id: hostId }) : null}
						/>
					</PageLines>
				</ReadOnlyFields>
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
	payload: deadHostPayload,
	Fields: DeadHostFields,
});

export { showDeadHostModal };
