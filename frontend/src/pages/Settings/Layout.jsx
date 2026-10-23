import { T } from "src/locale";
import DefaultSite from "./DefaultSite";

export default function Layout() {
	return (
		<div className="card">
			<div className="card-status-top bg-teal" />
			<div className="card-header">
				<h3 className="card-title">
					<T id="settings.default-site" />
				</h3>
			</div>
			<DefaultSite />
		</div>
	);
}
