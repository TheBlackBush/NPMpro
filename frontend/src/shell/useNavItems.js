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

/** The main links the signed-in user may open, with icon and translated label */
export function useNavItems() {
	const { data: user } = useUser("me");
	return visibleNavItems(user).map((item) => ({
		...item,
		Icon: ICONS[item.id],
		label: intl.formatMessage({ id: item.labelKey }),
	}));
}
