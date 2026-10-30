import { T } from "src/locale";
import { parseTrustedIps } from "src/modules/RuntimeSettings";
import { networkValidate } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { RuntimeSection } from "./Runtime/RuntimeSection";

const toForm = (data) => ({
	trustedIps: (data.trustedIps ?? []).join("\n"),
	trustCloudflare: Boolean(data.trustCloudflare),
});

const toApi = (values) => ({ ...values, trustedIps: parseTrustedIps(values.trustedIps).list });

const validate = networkValidate(validations);

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
