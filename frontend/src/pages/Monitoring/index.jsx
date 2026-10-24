import { IconChartBar } from "@tabler/icons-react";
import { NavLink, useParams } from "react-router";
import { ErrorNotFound, HasPermission, PageHeader } from "src/components";
import { intl, T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Traffic from "./Traffic";

// one entry per tab, in the URL as /monitoring/<id>
const TABS = [{ id: "traffic", labelKey: "monitoring.tab.traffic", icon: IconChartBar, element: Traffic }];

const Monitoring = () => {
	const { tab } = useParams();
	const current = TABS.find((t) => t.id === tab);
	const Tab = current?.element;

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
