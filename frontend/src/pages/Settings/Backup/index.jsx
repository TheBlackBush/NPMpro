import { SettingsHeading } from "../SettingsHeading";
import { SettingsLead } from "../SettingsLead";
import { CreateCard } from "./CreateCard";
import { SchedulesCard } from "./SchedulesCard";
import { StoredTable } from "./StoredTable";

export default function Backup() {
	return (
		<div className="space-y-4">
			<SettingsHeading titleId="settings.backup" />
			<SettingsLead id="settings.backup.intro" />
			<CreateCard />
			<SchedulesCard />
			<StoredTable />
		</div>
	);
}
