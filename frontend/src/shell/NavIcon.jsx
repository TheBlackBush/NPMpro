import {
	Activity,
	BadgeCheck,
	ChartColumn,
	ChartLine,
	Database,
	DatabaseBackup,
	Disc,
	Earth,
	FileBadge,
	Globe,
	History,
	KeyRound,
	LayoutDashboard,
	ListTree,
	Lock,
	LockKeyhole,
	Network,
	Server,
	ServerCog,
	Settings,
	Shield,
	ShieldCheck,
	Shuffle,
	SlidersHorizontal,
	Users,
	Zap,
	ZapOff,
} from "lucide-react";

// the lucide icons of modules/Navigation.js, by the names it gives its groups and pages
const ICONS = {
	Activity,
	BadgeCheck,
	ChartColumn,
	ChartLine,
	Database,
	DatabaseBackup,
	Disc,
	Earth,
	FileBadge,
	Globe,
	History,
	KeyRound,
	LayoutDashboard,
	ListTree,
	Lock,
	LockKeyhole,
	Network,
	Server,
	ServerCog,
	Settings,
	Shield,
	ShieldCheck,
	Shuffle,
	SlidersHorizontal,
	Users,
	Zap,
	ZapOff,
};

/**
 * A group's or page's icon (decorative: the text next to it or the tooltip names it)
 *
 * @param {Object} props
 * @param {string} props.name       the icon name of modules/Navigation.js
 * @param {string} [props.className]
 */
export function NavIcon({ name, className }) {
	const Icon = ICONS[name];
	return <Icon className={className} aria-hidden="true" />;
}
