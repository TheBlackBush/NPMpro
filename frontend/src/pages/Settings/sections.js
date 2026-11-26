import {
	BadgeCheck,
	Bell,
	ChartColumn,
	DatabaseBackup,
	Database as DatabaseIcon,
	Globe,
	KeyRound,
	LayoutList,
	Lock,
	MapPin,
	Network as NetworkIcon,
	PanelsTopLeft,
	ScrollText,
	ServerCog,
	ShieldBan,
	ShieldCheck,
	SlidersHorizontal,
	Users as UsersIcon,
} from "lucide-react";
import AuditLog from "src/pages/AuditLog";
import Users from "src/pages/Users";
import Advanced from "./Advanced";
import ApiAccess from "./ApiAccess";
import Authentication from "./Authentication";
import Backup from "./Backup";
import Certificates from "./Certificates";
import Crowdsec from "./Crowdsec";
import Database from "./Database";
import DynamicDns from "./DynamicDns";
import Environment from "./Environment";
import ForwardAuth from "./ForwardAuth";
import Geoip from "./Geoip";
import LandingPages from "./LandingPages";
import Monitoring from "./Monitoring";
import Network from "./Network";
import Nginx from "./Nginx";
import Notifications from "./Notifications";

// each section names its category (modules/SettingsSections.js); the menu shows them category by category, in
// this order. The URLs are the ids and do not change with the category.
export const SECTIONS = [
	{
		id: "landing-pages",
		category: "sites",
		labelKey: "settings.landing-pages",
		icon: PanelsTopLeft,
		element: LandingPages,
	},
	{ id: "network", category: "sites", labelKey: "settings.network", icon: NetworkIcon, element: Network },
	{ id: "nginx", category: "sites", labelKey: "settings.nginx", icon: ServerCog, element: Nginx },
	{
		id: "dynamic-dns",
		category: "sites",
		labelKey: "settings.dynamic-dns",
		icon: Globe,
		element: DynamicDns,
	},
	{
		id: "authentication",
		category: "security",
		labelKey: "settings.authentication",
		icon: Lock,
		element: Authentication,
	},
	{
		id: "forward-auth",
		category: "security",
		labelKey: "settings.forward-auth",
		icon: ShieldCheck,
		element: ForwardAuth,
	},
	{ id: "crowdsec", category: "security", labelKey: "settings.crowdsec", icon: ShieldBan, element: Crowdsec },
	{
		id: "certificates",
		category: "security",
		labelKey: "settings.certificates",
		icon: BadgeCheck,
		element: Certificates,
	},
	// the route stays /settings/monitoring so existing links keep working
	{
		id: "monitoring",
		category: "monitoring",
		labelKey: "settings.monitoring",
		icon: ChartColumn,
		element: Monitoring,
	},
	{ id: "geoip", category: "monitoring", labelKey: "settings.geoip", icon: MapPin, element: Geoip },
	{
		id: "notifications",
		category: "monitoring",
		labelKey: "settings.notifications",
		icon: Bell,
		element: Notifications,
	},
	{ id: "backup", category: "data", labelKey: "settings.backup", icon: DatabaseBackup, element: Backup },
	{ id: "database", category: "data", labelKey: "settings.database", icon: DatabaseIcon, element: Database },
	{ id: "advanced", category: "system", labelKey: "settings.advanced", icon: SlidersHorizontal, element: Advanced },
	{
		id: "environment",
		category: "system",
		labelKey: "settings.environment",
		icon: LayoutList,
		element: Environment,
	},
	// Users and Audit Log keep their own permission rule (ADMIN/VIEW, checked by the Settings page and by each page
	// component); the palette offers them to admins like every other section
	{ id: "users", category: "administration", labelKey: "users", icon: UsersIcon, element: Users },
	{ id: "audit-log", category: "administration", labelKey: "auditlogs", icon: ScrollText, element: AuditLog },
	{
		id: "api-access",
		category: "administration",
		labelKey: "settings.api-access",
		icon: KeyRound,
		element: ApiAccess,
	},
];
