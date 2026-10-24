import { IconChartBar, IconLock, IconWorld, IconWorldPin } from "@tabler/icons-react";
import Authentication from "./Authentication";
import DefaultSite from "./DefaultSite";
import Geoip from "./Geoip";
import Monitoring from "./Monitoring";

export const SECTIONS = [
	{ id: "default-site", labelKey: "settings.default-site", icon: IconWorld, element: DefaultSite },
	{ id: "authentication", labelKey: "settings.authentication", icon: IconLock, element: Authentication },
	{ id: "monitoring", labelKey: "settings.monitoring", icon: IconChartBar, element: Monitoring },
	{ id: "geoip", labelKey: "settings.geoip", icon: IconWorldPin, element: Geoip },
];
