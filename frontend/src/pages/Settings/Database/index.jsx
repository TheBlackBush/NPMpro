import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import { ApiErrorContent, ErrorAlert, Loading } from "src/components";
import { useDatabase } from "src/hooks";
import { T } from "src/locale";
import { showDatabaseMoveModal } from "src/modals";
import { isMoveActive } from "src/modules/DatabaseMove";
import { SettingsHeading } from "../SettingsHeading";
import { StatusAlert } from "../StatusAlert";
import { InUseCard } from "./InUseCard";
import { MoveCard } from "./MoveCard";
import { TablesCard } from "./TablesCard";

// a connection from the DB_* environment variables cannot be moved here: the variables would win at the next start
function EnvLock() {
	return (
		<StatusAlert variant="warning" icon={Lock}>
			<div className="font-medium">
				<T id="settings.database.env.title" />
			</div>
			<div>
				<T id="settings.database.env.text" />
			</div>
		</StatusAlert>
	);
}

/**
 * Settings > Database: the database in use, its tables, and the form to move everything to another database
 */
export default function Database() {
	// always fetched on a visit: the check for a running move below must not use a cached answer
	const { data, isPending, error, isFetchedAfterMount } = useDatabase({ refetchOnMount: "always" });
	const queryClient = useQueryClient();
	const checked = useRef(false);

	// a move that runs (started here before a reload, or by another administrator) opens its window on the progress
	useEffect(() => {
		if (!(data && isFetchedAfterMount) || checked.current) return;
		checked.current = true;
		if (isMoveActive(data.move)) {
			// the window starts from this answer, so it shows the move even when the old process is already gone
			queryClient.setQueryData(["database-move"], { move: data.move });
			showDatabaseMoveModal({ status: data, target: data.move.target, moveId: data.move.id });
		}
	}, [data, isFetchedAfterMount, queryClient]);

	return (
		<div className="space-y-4">
			<SettingsHeading titleId="settings.database" className="mb-0" />
			<p className="text-muted-foreground">
				<T id="settings.database.intro" />
			</p>
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<ErrorAlert>
					<ApiErrorContent error={error} />
				</ErrorAlert>
			) : null}
			{data ? (
				<>
					<InUseCard data={data} />
					<TablesCard tables={data.tables} />
					{data.source === "env" ? <EnvLock /> : <MoveCard status={data} />}
				</>
			) : null}
		</div>
	);
}
