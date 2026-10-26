import { intl, T } from "src/locale";
import { parseTrustedIps } from "src/modules/RuntimeSettings";
import { RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { RuntimeSection } from "./Runtime/RuntimeSection";

const toForm = (data) => ({
	trustedIps: (data.trustedIps ?? []).join("\n"),
	trustCloudflare: Boolean(data.trustCloudflare),
});

const toApi = (values) => ({ ...values, trustedIps: parseTrustedIps(values.trustedIps).list });

// the backend accepts at most this many entries (schema/paths/settings/runtime/network/put.json)
const MAX_TRUSTED_IPS = 1000;

const validate = (values) => {
	const { list, errors } = parseTrustedIps(values.trustedIps);
	if (errors.length > 0) {
		return {
			trustedIps: errors.map(({ line, message }) => intl.formatMessage({ id: message }, { line })).join(" "),
		};
	}
	if (list.length > MAX_TRUSTED_IPS) {
		return {
			trustedIps: intl.formatMessage({ id: "settings.network.trusted-ips.too-many" }, { max: MAX_TRUSTED_IPS }),
		};
	}
	return {};
};

export default function Network() {
	return (
		<RuntimeSection group="network" titleId="settings.network" toForm={toForm} toApi={toApi} validate={validate}>
			<RuntimeText
				name="trustedIps"
				rows={5}
				label={<T id="settings.network.trusted-ips" />}
				hint={<T id="settings.network.trusted-ips.hint" />}
				placeholder={"10.0.0.0/8\n192.168.1.5\nfd00::/8"}
			/>
			<RuntimeSwitch
				name="trustCloudflare"
				className=""
				label={<T id="settings.network.trust-cloudflare" />}
				hint={<T id="settings.network.trust-cloudflare.hint" />}
			/>
		</RuntimeSection>
	);
}
