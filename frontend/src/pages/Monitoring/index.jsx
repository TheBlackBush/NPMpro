import { ActivityIcon, ChartColumnIcon, ExternalLinkIcon, ShieldIcon } from "lucide-react";
import { NavLink, useParams } from "react-router";
import { ErrorNotFound, HasPermission } from "src/components";
import { EmptyState } from "src/components/Monitoring";
import { Button } from "src/components/ui/button";
import { Card, CardContent } from "src/components/ui/card";
import { useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Crowdsec from "./Crowdsec";
import Traffic from "./Traffic";

// one entry per tab, in the URL as /monitoring/<id>
const TABS = [
	{ id: "traffic", labelKey: "monitoring.tab.traffic", icon: ChartColumnIcon, element: Traffic },
	{ id: "crowdsec", labelKey: "monitoring.tab.crowdsec", icon: ShieldIcon, element: Crowdsec },
];

const GOACCESS = "/goaccess";

// traffic statistics off and no CrowdSec bouncer: no tabs, nothing is fetched. A user with GoAccess on still gets the
// way to it (the menu points such users there; this covers a typed address).
function MonitoringOff({ goaccess }) {
	return (
		<Card>
			<CardContent>
				<EmptyState
					icon={ActivityIcon}
					title={<T id="monitoring.off" />}
					subtitle={<T id="monitoring.off.subtitle" />}
					to="/settings/monitoring"
					action={<T id="monitoring.traffic.enable" />}
				>
					{goaccess ? (
						<Button asChild>
							<a href={GOACCESS} target="_blank" rel="noopener noreferrer">
								<T id="settings.logs.goaccess.open" />
								<ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
							</a>
						</Button>
					) : null}
				</EmptyState>
			</CardContent>
		</Card>
	);
}

// the tabs (links, as the Certificates tabs) and the GoAccess link share one look; the open tab is the NavLink with
// aria-current="page", marked by the underline
const TAB =
	"relative inline-flex h-9 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-primary [&_svg]:size-4 [&_svg]:shrink-0";

const Monitoring = () => {
	const { tab } = useParams();
	const { data: user } = useUser("me");
	const current = TABS.find((t) => t.id === tab);
	const Tab = current?.element;

	// HasPermission shows the loading state until the user is loaded, so no tab mounts (and fetches) before the
	// monitoring flag is known
	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<section className="flex flex-col gap-4">
				<div className="flex min-w-0 items-center gap-2">
					{/* the menu's Monitoring icon; Monitoring has no section accent, so the primary look */}
					<ChartColumnIcon className="size-6 shrink-0 text-primary" aria-hidden="true" />
					<h1 className="text-2xl font-semibold tracking-tight">
						<T id="monitoring" />
					</h1>
				</div>
				{user?.monitoring ? (
					<>
						<nav
							className="flex flex-wrap items-center border-b"
							aria-label={intl.formatMessage({ id: "monitoring" })}
						>
							{/* the URL is the source: each tab is a link, NavLink marks the open one with aria-current */}
							{TABS.map(({ id, labelKey, icon: Icon }) => (
								<NavLink key={id} to={`/monitoring/${id}`} className={TAB}>
									<Icon aria-hidden="true" />
									<T id={labelKey} />
								</NavLink>
							))}
							{user.goaccess ? (
								<a href={GOACCESS} target="_blank" rel="noopener noreferrer" className={TAB}>
									<T id="goaccess" />
									<ExternalLinkIcon aria-hidden="true" />
								</a>
							) : null}
						</nav>
						{Tab ? <Tab /> : <ErrorNotFound level={2} />}
					</>
				) : (
					<MonitoringOff goaccess={user?.goaccess} />
				)}
			</section>
		</HasPermission>
	);
};

export default Monitoring;
