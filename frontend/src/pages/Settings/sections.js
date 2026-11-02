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
import { SETTINGS_SECTIONS } from "src/modules/SettingsSections";
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

// each section's icon and page, by its id in SETTINGS_SECTIONS (modules/SettingsSections.js), which keeps the order,
// the categories and the names
const PARTS = {
	"default-site": { icon: IconWorld, element: DefaultSite },
	network: { icon: IconNetwork, element: Network },
	nginx: { icon: IconServerCog, element: Nginx },
	authentication: { icon: IconLock, element: Authentication },
	"forward-auth": { icon: IconShieldCheck, element: ForwardAuth },
	certificates: { icon: IconCertificate, element: Certificates },
	monitoring: { icon: IconChartBar, element: Monitoring },
	geoip: { icon: IconWorldPin, element: Geoip },
	backup: { icon: IconDatabaseExport, element: Backup },
	database: { icon: IconDatabase, element: Database },
	advanced: { icon: IconAdjustments, element: Advanced },
	environment: { icon: IconListDetails, element: Environment },
};

export const SECTIONS = SETTINGS_SECTIONS.map((section) => ({ ...section, ...PARTS[section.id] }));
