import { useLocation } from "react-router";
import { NavLink } from "src/components";
import { T } from "src/locale";

const tabs = [
	{ key: "certificates", to: "/certificates", label: "certificates" },
	{ key: "dns-credentials", to: "/certificates/dns-credentials", label: "dns-credentials" },
];

export function Tabs() {
	const { pathname } = useLocation();
	const activeKey = pathname.startsWith("/certificates/dns-credentials") ? "dns-credentials" : "certificates";

	return (
		<div className="card-header">
			<ul className="nav nav-tabs card-header-tabs">
				{tabs.map((tab) => (
					<li className="nav-item" key={tab.key}>
						<NavLink to={tab.to} active={activeKey === tab.key}>
							<T id={tab.label} />
						</NavLink>
					</li>
				))}
			</ul>
		</div>
	);
}
