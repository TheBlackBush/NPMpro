import { T } from "src/locale";
import { SettingsHeading } from "../SettingsHeading";
import { CreateCard } from "./CreateCard";
import { SchedulesCard } from "./SchedulesCard";
import { StoredTable } from "./StoredTable";

export default function Backup() {
	return (
		<div className="card-body">
			<SettingsHeading titleId="settings.backup" className="mb-2" />
			<p className="text-muted-foreground mb-4">
				<T id="settings.backup.intro" />
			</p>
			<CreateCard />
			<SchedulesCard />
			<StoredTable />
		</div>
	);
}
