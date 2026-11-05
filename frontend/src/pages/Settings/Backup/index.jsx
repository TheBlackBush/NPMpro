import { T } from "src/locale";
import { SettingsHeading } from "../SettingsHeading";
import { CreateCard } from "./CreateCard";
import { SchedulesCard } from "./SchedulesCard";
import { StoredTable } from "./StoredTable";

export default function Backup() {
	return (
		<div className="space-y-4">
			<SettingsHeading titleId="settings.backup" className="mb-0" />
			<p className="text-muted-foreground">
				<T id="settings.backup.intro" />
			</p>
			<CreateCard />
			<SchedulesCard />
			<StoredTable />
		</div>
	);
}
