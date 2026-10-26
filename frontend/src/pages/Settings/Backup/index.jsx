import { T } from "src/locale";
import { CreateCard } from "./CreateCard";
import { StoredTable } from "./StoredTable";

export default function Backup() {
	return (
		<div className="card-body">
			<h2 className="mb-2">
				<T id="settings.backup" />
			</h2>
			<p className="text-secondary mb-4">
				<T id="settings.backup.intro" />
			</p>
			<CreateCard />
			<StoredTable />
		</div>
	);
}
