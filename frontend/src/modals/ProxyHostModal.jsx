import { useFormContext, useWatch } from "react-hook-form";
import {
	AccessFields,
	DirectoryField,
	DomainNamesField,
	FormSection,
	ForwardFields,
	LocationsFields,
	ModalTabs,
	NginxConfigField,
	PageChoiceField,
	PageLines,
	ProxyOptionsFields,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	SwitchList,
	TabPane,
} from "src/components";
import { useAccessLists, useProxyHost, useSetProxyHost } from "src/hooks";
import { T } from "src/locale";
import { domainNamesOptions } from "src/modules/HostForms";
import { htmlName, PLACE_FIELDS, previewPath } from "src/modules/LandingPageForms";
import { PROXY_HOSTS } from "src/modules/Permissions";
import {
	namedLocations,
	PROXY_HOST_TABS,
	proxyHostDefaults,
	proxyHostPayload,
	proxyHostValidate,
} from "src/modules/ProxyHostForms";
import { validations } from "src/modules/Validations";
import { createHostEditorModal } from "./HostEditorModal";

// field name -> label for the note next to Save (no control has these names)
const FIELD_LABELS = {
	locations: "column.custom-locations",
	npmproAccessListIds: "proxy-host.global-access-lists",
};

// the "*" of the Custom locations tab: a location with a path. Its own watch, so typing in a location row re-renders
// this marker, not the whole window
function LocationsTabMarker() {
	const locations = useWatch({ name: "locations" });
	return namedLocations(locations).length > 0 ? "*" : "";
}

function ProxyHostFields({ isAdmin, hostId }) {
	const { register } = useFormContext();
	const [certificateId, npmproDnsChallenge, npmproLocationConfig, npmproAuthRequest, advancedConfig, maintenance] =
		useWatch({
			name: [
				"certificateId",
				"npmproDnsChallenge",
				"npmproLocationConfig",
				"npmproAuthRequest",
				"advancedConfig",
				"npmproMaintenance",
			],
		});
	// a non-admin with no config at all gets the one hint, not one per field
	const isEmptyBoth = !(isAdmin || advancedConfig?.trim() || npmproLocationConfig?.trim());
	return (
		<ModalTabs
			tabs={PROXY_HOST_TABS}
			markers={{
				locations: <LocationsTabMarker />,
				pages: maintenance ? "*" : null,
				advanced: advancedConfig?.trim() || npmproLocationConfig?.trim() ? "*" : null,
			}}
		>
			<TabPane id="details">
				<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
				<ForwardFields className="mb-3" />
				<DirectoryField labelId="proxy-host.directory" />
				<ProxyOptionsFields />
				<FormSection heading legend={<T id="proxy-host.global-access-lists" />} className="mb-0">
					<AccessFields
						name="npmproAccessListIds"
						typeName="npmproAccessListType"
						authRequest={npmproAuthRequest}
					/>
				</FormSection>
			</TabPane>
			<TabPane id="locations" selfReadOnly>
				<LocationsFields />
			</TabPane>
			<TabPane id="tls">
				<SSLCertificateField label="ssl-certificate" allowNew />

				<SSLOptionsFields forProxyHost />
			</TabPane>
			<TabPane id="pages">
				<SwitchList>
					<SwitchField
						id="npmproMaintenance"
						label={<T id="landing-pages.maintenance-mode" />}
						{...register("npmproMaintenance")}
					/>
				</SwitchList>
				<p className="mt-1 mb-4 text-sm text-muted-foreground">
					<T id="landing-pages.maintenance-mode.hint" />
				</p>
				<PageLines>
					{PLACE_FIELDS.proxyHost.map((field) => (
						<PageChoiceField
							key={field.name}
							name={field.name}
							htmlName={htmlName(field.name)}
							title={<T id={field.labelId} />}
							codes={field.codes}
							hint={field.hintId ? <T id={field.hintId} /> : null}
							choices={field.choices}
							field={field}
							previewHref={
								isAdmin && hostId
									? previewPath({ source: "proxy-host", id: hostId, type: field.api })
									: null
							}
						/>
					))}
				</PageLines>
				<p className="mt-4 text-sm text-muted-foreground">
					<T id="landing-pages.global.hint" />
				</p>
			</TabPane>
			{/* the config fields are read-only in a View window themselves, so they can still be focused and scrolled */}
			<TabPane id="advanced" selfReadOnly>
				<NginxConfigField
					label="nginx-config.server.label"
					hint="proxy-host.server-config.hint"
					emptyHint={!isEmptyBoth}
				/>
				<NginxConfigField
					name="npmproLocationConfig"
					id="npmproLocationConfig"
					label="nginx-config.location.label"
					hint="nginx-config.location.hint"
					emptyHint={!isEmptyBoth}
				/>
				{isEmptyBoth && (
					<div className="my-3 text-center text-muted-foreground">
						<T id="nginx-config.admin-only" />
					</div>
				)}
			</TabPane>
		</ModalTabs>
	);
}

// the access-list read AccessFields uses, so nothing is fetched twice. The window also waits for it, so a user whose
// role is not known yet (its read failed and retries) starts as a non-admin clone would (no raw nginx config)
function useProxySettleOptions() {
	return { accessLists: useAccessLists(["owner", "items", "clients"]) };
}

const showProxyHostModal = createHostEditorModal({
	object: "proxy-host",
	section: PROXY_HOSTS,
	useHost: useProxyHost,
	useSave: useSetProxyHost,
	defaults: proxyHostDefaults,
	validate: proxyHostValidate(validations),
	payload: proxyHostPayload,
	Fields: ProxyHostFields,
	fieldLabels: FIELD_LABELS,
	useSettleOptions: useProxySettleOptions,
});

export { showProxyHostModal };
