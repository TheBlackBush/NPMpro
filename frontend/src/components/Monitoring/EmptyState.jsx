import { IconExternalLink } from "@tabler/icons-react";
import { Link } from "react-router";

/**
 * Tabler empty state (https://docs.tabler.io/ui/components/empty.md) for a monitoring source that is off or not set up,
 * with an optional link to the settings section that fixes it, or to an external page (`href`, opens in a new tab).
 *
 * @param {object} props
 * @param {import("react").ElementType} props.icon
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]
 * @param {string} [props.to]                       route of the action button
 * @param {string} [props.href]                     external address of the action button, instead of `to`
 * @param {import("react").ReactNode} [props.action] text of the action button
 */
function EmptyState({ icon: Icon, title, subtitle, to, href, action }) {
	return (
		<div className="empty">
			<div className="empty-icon">
				<Icon className="icon" aria-hidden="true" />
			</div>
			<p className="empty-title">{title}</p>
			{subtitle ? <p className="empty-subtitle text-secondary">{subtitle}</p> : null}
			{(to || href) && action ? (
				<div className="empty-action">
					{href ? (
						<a href={href} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
							{action}
							<IconExternalLink className="icon ms-2 me-0" aria-hidden="true" />
						</a>
					) : (
						<Link to={to} className="btn btn-primary">
							{action}
						</Link>
					)}
				</div>
			) : null}
		</div>
	);
}

export { EmptyState };
