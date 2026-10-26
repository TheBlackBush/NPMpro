import { intl, T } from "src/locale";
import { validateUpstreamUrl } from "src/modules/Validations";
import { RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection } from "./Runtime/RuntimeSection";

// provider names are product names, shown as they are
const PROVIDERS = [
	{ name: "anubisUpstream", provider: "Anubis", example: "http://127.0.0.1:8923" },
	{ name: "tinyauthUpstream", provider: "Tinyauth", example: "http://127.0.0.1:3000" },
	{ name: "oauth2proxyUpstream", provider: "OAuth2 Proxy", example: "http://127.0.0.1:4180" },
	{ name: "voidauthUpstream", provider: "VoidAuth", example: "http://127.0.0.1:3000" },
	{ name: "autheliaUpstream", provider: "Authelia", example: "http://127.0.0.1:9091" },
	{ name: "authentikUpstream", provider: "Authentik", example: "https://127.0.0.1:9443" },
];

const toForm = (data) => ({
	...Object.fromEntries(PROVIDERS.map(({ name }) => [name, data[name] ?? ""])),
	anubisCustomImages: Boolean(data.anubisCustomImages),
});

const toApi = (values) => ({
	...values,
	...Object.fromEntries(PROVIDERS.map(({ name }) => [name, values[name].trim()])),
});

const checkUrl = validateUpstreamUrl();
// the backend also limits the length (schema/paths/settings/runtime/forward-auth/put.json)
const checkUpstream = (value) =>
	value && value.length > 255
		? intl.formatMessage({ id: "error.max-character-length" }, { max: 255 })
		: checkUrl(value);

export default function ForwardAuth() {
	return (
		<RuntimeSection group="forward-auth" titleId="settings.forward-auth" toForm={toForm} toApi={toApi}>
			<p className="text-secondary">
				<T id="settings.forward-auth.intro" />
			</p>
			<Part titleId="settings.forward-auth.upstreams">
				{PROVIDERS.map(({ name, provider, example }) => (
					<RuntimeText
						key={name}
						name={name}
						type="url"
						label={<T id="settings.forward-auth.upstream" data={{ provider }} />}
						hint={<T id="settings.forward-auth.upstream.hint" data={{ provider }} />}
						placeholder={intl.formatMessage(
							{ id: "settings.forward-auth.upstream.placeholder" },
							{ example },
						)}
						validate={(value) => checkUpstream(value?.trim())}
					/>
				))}
			</Part>
			<Part titleId="settings.forward-auth.anubis" last>
				<RuntimeSwitch
					name="anubisCustomImages"
					className=""
					label={<T id="settings.forward-auth.anubis-images" />}
					hint={<T id="settings.forward-auth.anubis-images.hint" />}
				/>
			</Part>
		</RuntimeSection>
	);
}
