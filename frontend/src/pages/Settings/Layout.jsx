import { T } from "src/locale";
import DefaultSite from "./DefaultSite";

export default function Layout() {
	return (
		<div className="card">
			<div className="card-status-top bg-teal" />
			<div className="card-header">
				<h2 className="card-title">
					<T id="settings.default-site" />
				</h2>
			</div>
			<DefaultSite />
		</div>
	);
}
