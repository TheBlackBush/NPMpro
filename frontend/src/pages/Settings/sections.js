import { IconLock, IconWorld } from "@tabler/icons-react";
import Authentication from "./Authentication";
import DefaultSite from "./DefaultSite";

export const SECTIONS = [
	{ id: "default-site", labelKey: "settings.default-site", icon: IconWorld, element: DefaultSite },
	{ id: "authentication", labelKey: "settings.authentication", icon: IconLock, element: Authentication },
];
