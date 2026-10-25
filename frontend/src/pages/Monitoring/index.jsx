import { IconActivity, IconChartBar, IconShield } from "@tabler/icons-react";
import { NavLink, useParams } from "react-router";
import { ErrorNotFound, HasPermission, PageHeader } from "src/components";
import { EmptyState } from "src/components/Monitoring";
import { useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Crowdsec from "./Crowdsec";
import Traffic from "./Traffic";

// one entry per tab, in the URL as /monitoring/<id>
const TABS = [
	{ id: "traffic", labelKey: "monitoring.tab.traffic", icon: IconChartBar, element: Traffic },
	{ id: "crowdsec", labelKey: "monitoring.tab.crowdsec", icon: IconShield, element: Crowdsec },
];

// traffic statistics off and no CrowdSec bouncer: no tabs, nothing is fetched
function MonitoringOff() {
	return (
		<div className="card">
			<div className="card-body">
				<EmptyState
					icon={IconActivity}
					title={<T id="monitoring.off" />}
					subtitle={<T id="monitoring.off.subtitle" />}
					to="/settings/monitoring"
					action={<T id="monitoring.traffic.enable" />}
				/>
			</div>
		</div>
	);
}

const Monitoring = () => {
	const { tab } = useParams();
	const { data: user } = useUser("me");
	const current = TABS.find((t) => t.id === tab);
	const Tab = current?.element;

	if (user && !user.monitoring) {
		return (
			<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
				<PageHeader title={<T id="monitoring" />} />
				<MonitoringOff />
			</HasPermission>
		);
	}

	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<PageHeader title={<T id="monitoring" />} />
			<nav className="nav nav-tabs mb-3" aria-label={intl.formatMessage({ id: "monitoring" })}>
				{TABS.map(({ id, labelKey, icon: Icon }) => (
					<NavLink key={id} to={`/monitoring/${id}`} className="nav-link">
						<Icon className="icon me-2" aria-hidden="true" />
						<T id={labelKey} />
					</NavLink>
				))}
			</nav>
			{Tab ? <Tab /> : <ErrorNotFound />}
		</HasPermission>
	);
};

export default Monitoring;
