import { House, Lock, Puzzle, SearchX, ShieldOff, TriangleAlert, Unplug, Wrench } from "lucide-react";
import { cn } from "src/lib/utils";

const ICONS = {
	searchMinus: SearchX,
	unplug: Unplug,
	lock: Lock,
	wrench: Wrench,
	triangleAlert: TriangleAlert,
	shieldOff: ShieldOff,
	puzzle: Puzzle,
	house: House,
};
// the landing pages' colours by meaning (backend/landing-pages/pages.js)
const TONES = {
	red: "bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-400",
	amber: "bg-amber-50 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
	neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-400",
	blue: "bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400",
};

/**
 * A small drawing of a built-in landing page: its icon in the page's colour, the NPMpro divider and its code. Not a
 * render of the page (the admin UI's CSP allows no frames); Preview shows the real one.
 *
 * @param {Object} props
 * @param {{ tone: string, icon: string, code: number|null }} props.page  an entry of PAGE_TYPES or DEFAULT_PAGE
 * @param {string} [props.className]
 */
function PageThumbnail({ page, className }) {
	const Icon = ICONS[page.icon];
	return (
		<div
			aria-hidden="true"
			className={cn(
				"flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border bg-muted/40",
				className,
			)}
		>
			<span className={cn("flex size-7 items-center justify-center rounded-full", TONES[page.tone])}>
				<Icon className="size-4" />
			</span>
			<span className="h-0.5 w-5 rounded-full bg-linear-to-r from-[#FFAC1C] via-[#FF1457] to-[#5415FF]" />
			{page.code ? <span className="text-xs leading-none font-extrabold">{page.code}</span> : null}
		</div>
	);
}

export { PageThumbnail };
