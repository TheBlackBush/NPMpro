import { intl, T } from "src/locale";
import { ddnsSettingsValidate, ddnsToApi, ddnsToForm, isServiceUrl, MAX_SERVICES } from "src/modules/DdnsSettings";
import { isResolverAddress, MAX_RESOLVER_ADDRESSES } from "src/modules/ResolverAddress";
import { validations } from "src/modules/Validations";
import { RuntimeChips, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";

const validate = (values, data) => ddnsSettingsValidate(validations, values, data);

// a typed service is taken only when it is an https URL and the list has room, as the save checks it
const isNewService = (text, held) => isServiceUrl(text) && held.length < MAX_SERVICES;
const refusedServices = (refused) =>
	refused.every(isServiceUrl)
		? intl.formatMessage({ id: "settings.dynamic-dns.services.count" })
		: intl.formatMessage(
				{ id: "settings.dynamic-dns.services.invalid" },
				{ url: refused.filter((entry) => !isServiceUrl(entry)).join(", ") },
			);
const isNewAddress = (text, held) => isResolverAddress(text) && held.length < MAX_RESOLVER_ADDRESSES;
const refusedAddresses = (refused) =>
	refused.every(isResolverAddress)
		? intl.formatMessage({ id: "settings.nginx.resolver.too-many" })
		: intl.formatMessage(
				{ id: "settings.nginx.resolver.invalid" },
				{ address: refused.filter((entry) => !isResolverAddress(entry)).join(", ") },
			);

function Cards() {
	const { warningsOf } = useRuntimeSection();
	return (
		<Part titleId="settings.dynamic-dns.card" infoId="settings.dynamic-dns.card.info">
			<RuntimeText
				name="period"
				label={<T id="settings.dynamic-dns.period" />}
				hint={<T id="settings.dynamic-dns.period.hint" />}
				placeholder="5m"
			/>
			<RuntimeText
				name="cooldown"
				label={<T id="settings.dynamic-dns.cooldown" />}
				hint={<T id="settings.dynamic-dns.cooldown.hint" />}
				placeholder="5m"
			/>
			<RuntimeChips
				name="ipv4Services"
				label={<T id="settings.dynamic-dns.ipv4-services" />}
				hint={<T id="settings.dynamic-dns.services.hint" />}
				placeholder="https://"
				isValidNew={isNewService}
				refusedMessage={refusedServices}
				notes={warningsOf("ipv4Services")}
			/>
			<RuntimeChips
				name="ipv6Services"
				label={<T id="settings.dynamic-dns.ipv6-services" />}
				hint={<T id="settings.dynamic-dns.services.hint" />}
				placeholder="https://"
				isValidNew={isNewService}
				refusedMessage={refusedServices}
				notes={warningsOf("ipv6Services")}
			/>
			<RuntimeChips
				name="resolver"
				label={<T id="settings.dynamic-dns.resolver" />}
				hint={<T id="settings.dynamic-dns.resolver.hint" />}
				placeholder="1.1.1.1"
				isValidNew={isNewAddress}
				refusedMessage={refusedAddresses}
				notes={warningsOf("resolver")}
			/>
		</Part>
	);
}

export default function DynamicDns() {
	return (
		<RuntimeSection
			group="ddns"
			titleId="settings.dynamic-dns"
			leadId="settings.dynamic-dns.intro"
			toForm={ddnsToForm}
			toApi={ddnsToApi}
			validate={validate}
		>
			<Cards />
		</RuntimeSection>
	);
}
