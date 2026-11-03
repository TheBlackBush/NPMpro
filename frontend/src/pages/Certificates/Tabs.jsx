import { Link, useLocation } from "react-router";
import { CountBadge } from "src/components/CountBadge";
import { useCertificates, useDnsCredentials } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	CERTIFICATE_LIST_EXPAND,
	CERTIFICATE_TABS,
	certificateTab,
	DNS_CREDENTIAL_LIST_EXPAND,
} from "src/modules/CertificateTabs";

const TAB =
	"relative inline-flex h-9 items-center gap-2 px-3 text-sm font-medium text-muted-foreground hover:text-foreground";
const TAB_ACTIVE = "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary";

/**
 * The tabs of the Certificates & DNS page as links: the open one is marked with aria-current and an underline. Each
 * tab shows its item count once its list is loaded; the lists are read with the pages' own expand lists, so the open
 * page's request is shared from the cache.
 */
export function CertificateTabs() {
	const { pathname } = useLocation();
	const active = certificateTab(pathname);
	const certificates = useCertificates(CERTIFICATE_LIST_EXPAND);
	const dnsCredentials = useDnsCredentials(DNS_CREDENTIAL_LIST_EXPAND);
	const counts = {
		certificates: certificates.data?.length,
		"dns-credentials": dnsCredentials.data?.length,
	};

	return (
		<nav aria-label={intl.formatMessage({ id: "certificates-dns" })} className="flex border-b">
			{CERTIFICATE_TABS.map((tab) => (
				<Link
					key={tab.key}
					to={tab.to}
					aria-current={active === tab.key ? "page" : undefined}
					className={cn(TAB, active === tab.key && TAB_ACTIVE)}
				>
					<T id={tab.labelId} />
					{counts[tab.key] === undefined ? null : (
						<>
							{/* the sr-only count reads "Certificates, 5 items" */}
							<span className="sr-only">, </span>
							<CountBadge count={counts[tab.key]} section="certificates" />
						</>
					)}
				</Link>
			))}
		</nav>
	);
}
