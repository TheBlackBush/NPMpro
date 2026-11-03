import { ShieldCheck } from "lucide-react";
import { SwitchList } from "src/components";
import { T } from "src/locale";
import { timeZoneOptions } from "src/modules/RuntimeSettings";
import { RuntimeSelect, RuntimeSwitch } from "./Runtime/fields";
import { RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";
import { SettingsCard } from "./SettingsCard";
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
			className=""
		/>
	);
}

export default function Advanced() {
	return (
		<RuntimeSection group="advanced" titleId="settings.advanced" toForm={toForm} toApi={toApi}>
			<SettingsCard>
				<SwitchList>
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
				</SwitchList>
				<StatusAlert variant="secondary" icon={ShieldCheck} id="settings.advanced.gravatar.privacy" />
			</SettingsCard>
			<SettingsCard>
				<TimeZoneField />
			</SettingsCard>
		</RuntimeSection>
	);
}
