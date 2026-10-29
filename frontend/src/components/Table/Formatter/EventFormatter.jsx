import {
	IconArrowsCross,
	IconBolt,
	IconBoltOff,
	IconCalendarTime,
	IconDatabase,
	IconDisc,
	IconKey,
	IconLock,
	IconSettings,
	IconShield,
	IconUser,
} from "@tabler/icons-react";
import cn from "clsx";
import { formatDateTime, T } from "src/locale";
import { BreakableHost } from "./BreakableHost";

const getEventValue = (event) => {
	switch (event.objectType) {
		case "access-list":
		case "backup":
		case "backup-schedule":
		case "database":
		case "dns-credential":
		case "user":
			return event.meta?.name;
		case "proxy-host":
		case "redirection-host":
		case "dead-host":
			return event.meta?.domainNames?.join(", ");
		case "stream":
			return event.meta?.incomingPort;
		case "certificate":
			return event.meta?.domainNames?.join(", ") || event.meta?.niceName || "N/A";
		case "setting":
			return event.meta?.id;
		default:
			break;
	}
};

const getColorForAction = (action) => {
	switch (action) {
		case "created":
		case "backup-succeeded":
		case "moved":
			return "text-lime";
		case "deleted":
		case "backup-failed":
		case "move-failed":
			return "text-red";
		default:
			return "text-blue";
	}
};

const getIcon = (row) => {
	const c = cn(getColorForAction(row.action), "me-1");
	let ico = null;
	switch (row.objectType) {
		case "user":
			ico = <IconUser size={16} className={c} />;
			break;
		case "proxy-host":
			ico = <IconBolt size={16} className={c} />;
			break;
		case "redirection-host":
			ico = <IconArrowsCross size={16} className={c} />;
			break;
		case "dead-host":
			ico = <IconBoltOff size={16} className={c} />;
			break;
		case "stream":
			ico = <IconDisc size={16} className={c} />;
			break;
		case "access-list":
			ico = <IconLock size={16} className={c} />;
			break;
		case "dns-credential":
			ico = <IconKey size={16} className={c} />;
			break;
		case "certificate":
			ico = <IconShield size={16} className={c} />;
			break;
		case "setting":
			ico = <IconSettings size={16} className={c} />;
			break;
		case "backup-schedule":
			ico = <IconCalendarTime size={16} className={c} />;
			break;
		case "database":
			ico = <IconDatabase size={16} className={c} />;
			break;
		default:
			break;
	}

	return ico;
};

export function EventFormatter({ row }) {
	return (
		<div className="flex-fill">
			<div className="fw-medium">
				{getIcon(row)}
				<T id={`object.event.${row.action}`} tData={{ object: row.objectType }} />:{" "}
				<span className="badge text-wrap text-start">
					<BreakableHost value={String(getEventValue(row) ?? "")} />
				</span>
			</div>
			<div className="text-secondary mt-1">{formatDateTime(row.createdOn)}</div>
		</div>
	);
}
