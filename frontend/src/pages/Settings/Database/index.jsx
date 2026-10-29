import { IconLock } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiErrorContent, ErrorAlert, Loading } from "src/components";
import { useDatabase } from "src/hooks";
import { T } from "src/locale";
import { showDatabaseMoveModal } from "src/modals";
import { isMoveActive } from "src/modules/DatabaseMove";
import { InUseCard } from "./InUseCard";
import { MoveCard } from "./MoveCard";
import { TablesCard } from "./TablesCard";

// a connection from the DB_* environment variables cannot be moved here: the variables would win at the next start
function EnvLock() {
	return (
		<div className="alert alert-warning">
			<div className="alert-icon">
				<IconLock className="icon alert-icon" aria-hidden="true" />
			</div>
			<div>
				<h4 className="alert-heading">
					<T id="settings.database.env.title" />
				</h4>
				<div className="alert-description">
					<T id="settings.database.env.text" />
				</div>
			</div>
		</div>
	);
}

/**
 * Settings > Database: the database in use, its tables, and the form to move everything to another database
 */
export default function Database() {
	const { data, isPending, error } = useDatabase();
	const queryClient = useQueryClient();
	const checked = useRef(false);

	// a move that runs (started here before a reload, or by another administrator) opens its window on the progress
	useEffect(() => {
		if (!data || checked.current) return;
		checked.current = true;
		if (isMoveActive(data.move)) {
			// the window starts from this answer, so it shows the move even when the old process is already gone
			queryClient.setQueryData(["database-move"], { move: data.move });
			showDatabaseMoveModal({ status: data, target: data.move.target, moveId: data.move.id });
		}
	}, [data, queryClient]);

	return (
		<div className="card-body">
			<h2 className="mb-2">
				<T id="settings.database" />
			</h2>
			<p className="text-secondary mb-4">
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
