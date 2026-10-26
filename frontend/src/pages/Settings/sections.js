import {
	IconAdjustments,
	IconCertificate,
	IconChartBar,
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
import DefaultSite from "./DefaultSite";
import Environment from "./Environment";
import ForwardAuth from "./ForwardAuth";
import Geoip from "./Geoip";
import Monitoring from "./Monitoring";
import Network from "./Network";
import Nginx from "./Nginx";

export const SECTIONS = [
	{ id: "default-site", labelKey: "settings.default-site", icon: IconWorld, element: DefaultSite },
	{ id: "authentication", labelKey: "settings.authentication", icon: IconLock, element: Authentication },
	{ id: "certificates", labelKey: "settings.certificates", icon: IconCertificate, element: Certificates },
	{ id: "network", labelKey: "settings.network", icon: IconNetwork, element: Network },
	{ id: "nginx", labelKey: "settings.nginx", icon: IconServerCog, element: Nginx },
	{ id: "forward-auth", labelKey: "settings.forward-auth", icon: IconShieldCheck, element: ForwardAuth },
	// the route stays /settings/monitoring so existing links keep working
	{ id: "monitoring", labelKey: "settings.monitoring", icon: IconChartBar, element: Monitoring },
	{ id: "geoip", labelKey: "settings.geoip", icon: IconWorldPin, element: Geoip },
	{ id: "advanced", labelKey: "settings.advanced", icon: IconAdjustments, element: Advanced },
	{ id: "backup", labelKey: "settings.backup", icon: IconDatabaseExport, element: Backup },
	{ id: "environment", labelKey: "settings.environment", icon: IconListDetails, element: Environment },
];
