import {
	CalendarClock,
	CloudCog,
	Database,
	Disc,
	KeyRound,
	Lock,
	Settings,
	Shield,
	Shuffle,
	User,
	Webhook,
	Zap,
	ZapOff,
} from "lucide-react";
import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";
import { formatDateTime, T } from "src/locale";
import { BreakableHost } from "./BreakableHost";

const getEventValue = (event) => {
	switch (event.objectType) {
		case "access-list":
		case "backup":
		case "api-token":
		case "backup-schedule":
		case "database":
		case "dns-credential":
		case "user":
		case "webhook":
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
		case "acme-account":
			return event.meta?.server;
		default:
			break;
	}
};

const getColorForAction = (action) => {
	switch (action) {
		case "created":
		case "backup-succeeded":
		case "moved":
		case "oidc-linked":
		case "registered":
			return "text-success";
		case "deleted":
		case "revoked":
		case "expired":
		case "backup-failed":
		case "registration-failed":
		case "replace-failed":
		case "move-failed":
		case "oidc-refused":
			return "text-destructive";
		default:
			return "text-primary";
	}
};

const getIcon = (row) => {
	const c = cn(getColorForAction(row.action), "mr-1 inline-block size-4 align-text-bottom");
	let ico = null;
	switch (row.objectType) {
		case "user":
			ico = <User className={c} aria-hidden="true" />;
			break;
		case "proxy-host":
			ico = <Zap className={c} aria-hidden="true" />;
			break;
		case "redirection-host":
			ico = <Shuffle className={c} aria-hidden="true" />;
			break;
		case "dead-host":
			ico = <ZapOff className={c} aria-hidden="true" />;
			break;
		case "stream":
			ico = <Disc className={c} aria-hidden="true" />;
			break;
		case "access-list":
			ico = <Lock className={c} aria-hidden="true" />;
			break;
		case "dns-credential":
			ico = <KeyRound className={c} aria-hidden="true" />;
			break;
		case "certificate":
			ico = <Shield className={c} aria-hidden="true" />;
			break;
		case "setting":
			ico = <Settings className={c} aria-hidden="true" />;
			break;
		case "backup-schedule":
			ico = <CalendarClock className={c} aria-hidden="true" />;
			break;
		case "api-token":
			ico = <KeyRound className={c} aria-hidden="true" />;
			break;
		case "acme-account":
			ico = <CloudCog className={c} aria-hidden="true" />;
			break;
		case "webhook":
			ico = <Webhook className={c} aria-hidden="true" />;
			break;
		case "database":
			ico = <Database className={c} aria-hidden="true" />;
			break;
		default:
			break;
	}

	return ico;
};

export function EventFormatter({ row }) {
	return (
		<div className="flex-1">
			<div className="font-medium">
				{getIcon(row)}
				<T id={`object.event.${row.action}`} tData={{ object: row.objectType }} />:{" "}
				<Badge variant="secondary" className="h-auto py-0.5 text-left whitespace-normal">
					<BreakableHost value={String(getEventValue(row) ?? "")} />
				</Badge>
			</div>
			<div className="mt-1 text-muted-foreground">{formatDateTime(row.createdOn)}</div>
			{row.npmproApiTokenName ? (
				<div className="text-muted-foreground text-sm break-words">
					<T id="audit.via-token" data={{ name: row.npmproApiTokenName }} />
				</div>
			) : null}
		</div>
	);
}
