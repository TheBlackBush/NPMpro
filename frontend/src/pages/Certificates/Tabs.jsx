import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { CountBadge } from "src/components/CountBadge";
import { useCertificates, useDdnsRecords, useDnsCredentials, useDnsDomains } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	CERTIFICATE_LIST_EXPAND,
	CERTIFICATE_TABS,
	certificateTab,
	DDNS_RECORD_LIST_EXPAND,
	DNS_CREDENTIAL_LIST_EXPAND,
	DNS_DOMAIN_LIST_EXPAND,
} from "src/modules/CertificateTabs";

const TAB =
	"relative inline-flex h-9 shrink-0 items-center whitespace-nowrap gap-2 px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2";
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
	const dnsDomains = useDnsDomains(DNS_DOMAIN_LIST_EXPAND);
	const ddnsRecords = useDdnsRecords(DDNS_RECORD_LIST_EXPAND);
	const counts = {
		certificates: certificates.data?.length,
		"dns-credentials": dnsCredentials.data?.length,
		domains: dnsDomains.data?.length,
		"dynamic-dns": ddnsRecords.data?.length,
	};
	const strip = useRef(null);
	// on a phone the strip scrolls sideways: bring the open tab, with its badge, into view when the tab changes or a
	// badge arrives (it widens the tab), never on another render, so a strip the user scrolled stays where it is
	const badges = Object.values(counts).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the open tab and the badges are the trigger
	useEffect(() => {
		strip.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [active, badges]);

	return (
		<nav
			ref={strip}
			aria-label={intl.formatMessage({ id: "certificates-dns" })}
			className="flex overflow-x-auto border-b"
		>
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
							{/* the badge is for the eyes; the link reads "Certificates, 5 items" once */}
							<span className="sr-only">
								, {intl.formatMessage({ id: "list.count" }, { count: counts[tab.key] })}
							</span>
							<span aria-hidden="true" className="contents">
								<CountBadge count={counts[tab.key]} section="certificates" />
							</span>
						</>
					)}
				</Link>
			))}
		</nav>
	);
}
