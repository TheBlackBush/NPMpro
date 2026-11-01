import {
	IconAdjustments,
	IconCertificate,
	IconChartBar,
	IconDatabase,
	IconDatabaseExport,
	IconListDetails,
	IconLock,
	IconNetwork,
	IconServerCog,
	IconShieldCheck,
	IconWorld,
	IconWorldPin,
} from "@tabler/icons-react";
import Advanced from "./Advanced";
import Authentication from "./Authentication";
import Backup from "./Backup";
import Certificates from "./Certificates";
import Database from "./Database";
import DefaultSite from "./DefaultSite";
import Environment from "./Environment";
import ForwardAuth from "./ForwardAuth";
import Geoip from "./Geoip";
import Monitoring from "./Monitoring";
import Network from "./Network";
import Nginx from "./Nginx";

// each section names its category (modules/SettingsSections.js); the menu shows them category by category, in
// this order. The URLs are the ids and do not change with the category.
export const SECTIONS = [
	{ id: "default-site", category: "sites", labelKey: "settings.default-site", icon: IconWorld, element: DefaultSite },
	{ id: "network", category: "sites", labelKey: "settings.network", icon: IconNetwork, element: Network },
	{ id: "nginx", category: "sites", labelKey: "settings.nginx", icon: IconServerCog, element: Nginx },
	{
		id: "authentication",
		category: "security",
		labelKey: "settings.authentication",
		icon: IconLock,
		element: Authentication,
	},
	{
		id: "forward-auth",
		category: "security",
		labelKey: "settings.forward-auth",
		icon: IconShieldCheck,
		element: ForwardAuth,
	},
	{
		id: "certificates",
		category: "security",
		labelKey: "settings.certificates",
		icon: IconCertificate,
		element: Certificates,
	},
	// the route stays /settings/monitoring so existing links keep working
	{
		id: "monitoring",
		category: "monitoring",
		labelKey: "settings.monitoring",
		icon: IconChartBar,
		element: Monitoring,
	},
	{ id: "geoip", category: "monitoring", labelKey: "settings.geoip", icon: IconWorldPin, element: Geoip },
	{ id: "backup", category: "data", labelKey: "settings.backup", icon: IconDatabaseExport, element: Backup },
	{ id: "database", category: "data", labelKey: "settings.database", icon: IconDatabase, element: Database },
	{ id: "advanced", category: "system", labelKey: "settings.advanced", icon: IconAdjustments, element: Advanced },
	{
		id: "environment",
		category: "system",
		labelKey: "settings.environment",
		icon: IconListDetails,
		element: Environment,
	},
];
