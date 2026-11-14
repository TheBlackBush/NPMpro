import { ShieldCheck } from "lucide-react";
import { SettingLineNote } from "src/components";
import { T } from "src/locale";
import { timeZoneOptions } from "src/modules/RuntimeSettings";
import { RuntimeSelect, RuntimeSwitch } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";
import { StatusAlert } from "./StatusAlert";

const toForm = (data) => ({
	configBeautifier: Boolean(data.configBeautifier),
	gravatar: Boolean(data.gravatar),
	timeZone: data.timeZone,
});

const toApi = (values) => values;

// the zones the image ships, listed by the API with the settings
function TimeZoneField() {
	const { data } = useRuntimeSection();
	return (
		<RuntimeSelect
			name="timeZone"
			label={<T id="settings.advanced.time-zone" />}
			hint={<T id="settings.advanced.time-zone.hint" />}
			options={timeZoneOptions(data.timeZones, data.timeZone)}
		/>
	);
}

export default function Advanced() {
	return (
		<RuntimeSection
			group="advanced"
			titleId="settings.advanced"
			leadId="settings.advanced.intro"
			toForm={toForm}
			toApi={toApi}
		>
			<Part titleId="settings.advanced.configs" infoId="settings.advanced.configs.description">
				<RuntimeSwitch
					name="configBeautifier"
					label={<T id="settings.advanced.beautifier" />}
					hint={<T id="settings.advanced.beautifier.hint" />}
				/>
			</Part>
			<Part titleId="settings.advanced.users" infoId="settings.advanced.users.description">
				<RuntimeSwitch
					name="gravatar"
					label={<T id="settings.advanced.gravatar" />}
					hint={<T id="settings.advanced.gravatar.hint" />}
				/>
				<SettingLineNote>
					<StatusAlert variant="secondary" icon={ShieldCheck} id="settings.advanced.gravatar.privacy" />
				</SettingLineNote>
			</Part>
			<Part titleId="settings.advanced.time" infoId="settings.advanced.time.description">
				<TimeZoneField />
			</Part>
		</RuntimeSection>
	);
}
