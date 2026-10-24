import { IconShieldLock } from "@tabler/icons-react";
import { T } from "src/locale";
import { RuntimeSwitch } from "./Runtime/fields";
import { RuntimeSection } from "./Runtime/RuntimeSection";
import { StatusAlert } from "./StatusAlert";

const toForm = (data) => ({
	configBeautifier: Boolean(data.configBeautifier),
	gravatar: Boolean(data.gravatar),
});

const toApi = (values) => values;

export default function Advanced() {
	return (
		<RuntimeSection group="advanced" titleId="settings.advanced" toForm={toForm} toApi={toApi}>
			<RuntimeSwitch
				name="configBeautifier"
				label={<T id="settings.advanced.beautifier" />}
				hint={<T id="settings.advanced.beautifier.hint" />}
			/>
			<RuntimeSwitch
				name="gravatar"
				label={<T id="settings.advanced.gravatar" />}
				hint={<T id="settings.advanced.gravatar.hint" />}
			/>
			<StatusAlert
				variant="secondary"
				icon={IconShieldLock}
				id="settings.advanced.gravatar.privacy"
				className="mb-0"
			/>
		</RuntimeSection>
	);
}
