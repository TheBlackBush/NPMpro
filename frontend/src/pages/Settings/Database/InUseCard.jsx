import { FileText, Lock } from "lucide-react";
import { StatusBadge } from "src/components/StatusBadge";
import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";
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

function Item({ titleId, className, children }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<T id={titleId} />
			</dt>
			<dd className={cn("mt-1", className)}>{children}</dd>
		</div>
	);
}

/**
 * The database in use: engine and version, where the connection comes from, where it is, its size and the last move
 */
function InUseCard({ data }) {
	return (
		<SettingsCard title={<T id="settings.database.in-use" />}>
			<dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Item titleId="settings.database.engine">
					{engineLabel(data.engine)} {data.version}
				</Item>
				<Item titleId="settings.database.source">
					<SourceBadge source={data.source} />
				</Item>
				{data.engine === "sqlite" ? (
					<Item titleId="settings.database.file" className="break-words">
						{data.file}
					</Item>
				) : (
					<>
						<Item titleId="settings.database.host" className="break-words">
							{data.host}
						</Item>
						<Item titleId="settings.database.port">{data.port}</Item>
						<Item titleId="settings.database.name" className="break-words">
							{data.name}
						</Item>
						<Item titleId="settings.database.user" className="break-words">
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
					<Item titleId="settings.database.moved.title">
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
			</dl>
		</SettingsCard>
	);
}

export { InUseCard };
