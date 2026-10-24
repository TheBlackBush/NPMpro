import {
	IconAdjustments,
	IconCertificate,
	IconChartBar,
	IconListDetails,
	IconLock,
	IconNetwork,
	IconShieldCheck,
	IconWorld,
	IconWorldPin,
} from "@tabler/icons-react";
import Authentication from "./Authentication";
import DefaultSite from "./DefaultSite";
import Geoip from "./Geoip";
import Monitoring from "./Monitoring";
import { Advanced, Certificates, Environment, ForwardAuth, Network } from "./Placeholders";

export const SECTIONS = [
	{ id: "default-site", labelKey: "settings.default-site", icon: IconWorld, element: DefaultSite },
	{ id: "authentication", labelKey: "settings.authentication", icon: IconLock, element: Authentication },
	{ id: "certificates", labelKey: "settings.certificates", icon: IconCertificate, element: Certificates },
	{ id: "network", labelKey: "settings.network", icon: IconNetwork, element: Network },
	{ id: "forward-auth", labelKey: "settings.forward-auth", icon: IconShieldCheck, element: ForwardAuth },
	// the route stays /settings/monitoring so existing links keep working
	{ id: "monitoring", labelKey: "settings.monitoring", icon: IconChartBar, element: Monitoring },
	{ id: "geoip", labelKey: "settings.geoip", icon: IconWorldPin, element: Geoip },
	{ id: "advanced", labelKey: "settings.advanced", icon: IconAdjustments, element: Advanced },
	{ id: "environment", labelKey: "settings.environment", icon: IconListDetails, element: Environment },
];
