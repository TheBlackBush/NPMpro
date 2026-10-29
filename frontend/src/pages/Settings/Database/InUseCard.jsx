import { IconLock } from "@tabler/icons-react";
import { formatDateTime, intl, T } from "src/locale";
import { sourceBadge } from "src/modules/DatabaseMove";
import { formatBytes } from "src/modules/Monitoring";

const engineLabel = (engine) => intl.formatMessage({ id: `settings.database.engine.${engine}` });

function Item({ titleId, className, children }) {
	return (
		<div className="datagrid-item">
			<div className="datagrid-title">
				<T id={titleId} />
			</div>
			<div className={className ? `datagrid-content ${className}` : "datagrid-content"}>{children}</div>
		</div>
	);
}

/**
 * The database in use: engine and version, where the connection comes from, where it is, its size and the last move
 */
function InUseCard({ data }) {
	const badge = sourceBadge(data.source);
	return (
		<div className="card mb-4">
			<div className="card-header">
				<h3 className="card-title">
					<T id="settings.database.in-use" />
				</h3>
			</div>
			<div className="card-body">
				<div className="datagrid">
					<Item titleId="settings.database.engine">
						{engineLabel(data.engine)} {data.version}
					</Item>
					<Item titleId="settings.database.source">
						<span className={`badge ${badge.className}`}>
							{data.source === "env" ? <IconLock className="icon me-1" aria-hidden="true" /> : null}
							<T id={badge.labelId} />
						</span>
					</Item>
					{data.engine === "sqlite" ? (
						<Item titleId="settings.database.file" className="text-break">
							{data.file}
						</Item>
					) : (
						<>
							<Item titleId="settings.database.host" className="text-break">
								{data.host}
							</Item>
							<Item titleId="settings.database.port">{data.port}</Item>
							<Item titleId="settings.database.name" className="text-break">
								{data.name}
							</Item>
							<Item titleId="settings.database.user" className="text-break">
								{data.user}
							</Item>
						</>
					)}
					<Item titleId="settings.database.size">
						{data.size === null || data.size === undefined ? (
							<T id="settings.database.size.unknown" />
						) : (
							formatBytes(data.size)
						)}
					</Item>
					{data.movedAt ? (
						<Item titleId="audit-log.action.moved">
							<T
								id="settings.database.moved"
								data={{
									engine: data.movedFrom?.engine ? engineLabel(data.movedFrom.engine) : "",
									date: formatDateTime(data.movedAt),
								}}
							/>
						</Item>
					) : null}
				</div>
			</div>
		</div>
	);
}

export { InUseCard };
