import { intl, T } from "src/locale";
import { FORWARD_AUTH_PROVIDERS, forwardAuthValidate } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection } from "./Runtime/RuntimeSection";

const toForm = (data) => ({
	...Object.fromEntries(FORWARD_AUTH_PROVIDERS.map(({ name }) => [name, data[name] ?? ""])),
	anubisCustomImages: Boolean(data.anubisCustomImages),
});

const toApi = (values) => ({
	...values,
	...Object.fromEntries(FORWARD_AUTH_PROVIDERS.map(({ name }) => [name, values[name].trim()])),
});

const validate = forwardAuthValidate(validations);

export default function ForwardAuth() {
	return (
		<RuntimeSection
			group="forward-auth"
			titleId="settings.forward-auth"
			toForm={toForm}
			toApi={toApi}
			validate={validate}
		>
			<p className="text-secondary">
				<T id="settings.forward-auth.intro" />
			</p>
			<Part titleId="settings.forward-auth.upstreams">
				{FORWARD_AUTH_PROVIDERS.map(({ name, provider, example }) => (
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
