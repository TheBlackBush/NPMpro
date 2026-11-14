import { FileText, Lock } from "lucide-react";
import { SettingLine } from "src/components";
import { StatusBadge } from "src/components/StatusBadge";
import { Badge } from "src/components/ui/badge";
import { formatDateTime, intl, T } from "src/locale";
import { sourceBadge } from "src/modules/DatabaseMove";
import { formatBytes } from "src/modules/Monitoring";
import { SettingsCard } from "../SettingsCard";

const engineLabel = (engine) => intl.formatMessage({ id: `settings.database.engine.${engine}` });

// the source of the connection: set by the environment, read from a file, or the default
function SourceBadge({ source }) {
	const badge = sourceBadge(source);
	if (badge.tone === "warning") {
		return (
			<StatusBadge tone="warning" dot={false}>
				<Lock className="size-3" aria-hidden="true" />
				<T id={badge.labelId} />
			</StatusBadge>
		);
	}
	if (badge.tone === "file") {
		return (
			<Badge variant="outline">
				<FileText className="size-3" aria-hidden="true" />
				<T id={badge.labelId} />
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			<T id={badge.labelId} />
		</Badge>
	);
}

function Item({ id, titleId, children }) {
	return <SettingLine id={`database-in-use-${id}`} layout="value" title={<T id={titleId} />} control={children} />;
}

/**
 * The database in use: engine and version, where the connection comes from, where it is, its size and the last move
 */
function InUseCard({ data }) {
	return (
		<SettingsCard
			lines
			title={<T id="settings.database.in-use" />}
			info={<T id="settings.database.in-use.description" />}
		>
			<Item id="engine-name" titleId="settings.database.engine">
				{engineLabel(data.engine)} {data.version}
			</Item>
			<Item id="source" titleId="settings.database.source">
				<SourceBadge source={data.source} />
			</Item>
			{data.engine === "sqlite" ? (
				<Item id="file" titleId="settings.database.file">
					{data.file}
				</Item>
			) : (
				<>
					<Item id="host" titleId="settings.database.host">
						{data.host}
					</Item>
					<Item id="port" titleId="settings.database.port">
						{data.port}
					</Item>
					<Item id="name" titleId="settings.database.name">
						{data.name}
					</Item>
					<Item id="user" titleId="settings.database.user">
						{data.user}
					</Item>
				</>
			)}
			<Item id="size" titleId="settings.database.size">
				{data.size === null || data.size === undefined ? (
					<T id="settings.database.size.unknown" />
				) : (
					formatBytes(data.size)
				)}
			</Item>
			{data.movedAt ? (
				<Item id="moved" titleId="settings.database.moved.title">
					{data.movedFrom?.engine ? (
						<T
							id="settings.database.moved"
							data={{
								engine: engineLabel(data.movedFrom.engine),
								date: formatDateTime(data.movedAt),
							}}
						/>
					) : (
						<T id="settings.database.moved.date" data={{ date: formatDateTime(data.movedAt) }} />
					)}
				</Item>
			) : null}
		</SettingsCard>
	);
}

export { InUseCard };
