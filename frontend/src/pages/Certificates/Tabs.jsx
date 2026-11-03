import { Link, useLocation } from "react-router";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { CERTIFICATE_TABS, certificateTab } from "src/modules/CertificateTabs";

const TAB =
	"relative inline-flex h-9 items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground";
const TAB_ACTIVE = "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary";

/** The tabs of the Certificates page as links: the open one is marked with aria-current and an underline */
export function CertificateTabs() {
	const { pathname } = useLocation();
	const active = certificateTab(pathname);

	return (
		<nav aria-label={intl.formatMessage({ id: "certificates" })} className="flex border-b">
			{CERTIFICATE_TABS.map((tab) => (
				<Link
					key={tab.key}
					to={tab.to}
					aria-current={active === tab.key ? "page" : undefined}
					className={cn(TAB, active === tab.key && TAB_ACTIVE)}
				>
					<T id={tab.labelId} />
				</Link>
			))}
		</nav>
	);
}
