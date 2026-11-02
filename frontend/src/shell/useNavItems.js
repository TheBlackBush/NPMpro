import {
	ArrowLeftRight,
	ChartColumn,
	Disc3,
	LayoutDashboard,
	Lock,
	Settings,
	ShieldCheck,
	Unplug,
	Zap,
} from "lucide-react";
import { useUser } from "src/hooks";
import { intl } from "src/locale";
import { visibleNavItems } from "src/modules/Navigation";
import { NAV_SECTIONS } from "src/modules/SectionAccents";

const ICONS = {
	dashboard: LayoutDashboard,
	"proxy-hosts": Zap,
	"redirection-hosts": ArrowLeftRight,
	"dead-hosts": Unplug,
	streams: Disc3,
	certificates: ShieldCheck,
	"access-lists": Lock,
	monitoring: ChartColumn,
	settings: Settings,
};

/**
 * The menu icon of a list section (the same one its menu link shows); undefined for a section without a menu link
 *
 * @param {string} [section]  a key of SECTION_COLORS
 */
export function sectionIcon(section) {
	const navId = Object.keys(NAV_SECTIONS).find((id) => NAV_SECTIONS[id] === section);
	return navId ? ICONS[navId] : undefined;
}

/** The main links the signed-in user may open, with icon and translated label */
export function useNavItems() {
	const { data: user } = useUser("me");
	return visibleNavItems(user).map((item) => ({
		...item,
		Icon: ICONS[item.id],
		label: intl.formatMessage({ id: item.labelKey }),
	}));
}
