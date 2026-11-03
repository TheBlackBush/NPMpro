import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "src/components/ui/button";

/**
 * Empty state for a monitoring source that is off or not set up, with an optional link to the settings section that
 * fixes it, or to an external page (`href`, opens in a new tab).
 *
 * @param {object} props
 * @param {import("react").ElementType} props.icon
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]
 * @param {string} [props.to]                       route of the action button
 * @param {string} [props.href]                     external address of the action button, instead of `to`
 * @param {import("react").ReactNode} [props.action] text of the action button
 * @param {import("react").ReactNode} [props.children] a second action, shown after the first
 */
function EmptyState({ icon: Icon, title, subtitle, to, href, action, children }) {
	return (
		<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
			<div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-5" aria-hidden="true" />
			</div>
			<p className="m-0 text-base font-medium">{title}</p>
			{subtitle ? <p className="m-0 max-w-prose text-sm text-muted-foreground">{subtitle}</p> : null}
			{((to || href) && action) || children ? (
				<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
					{!(to || href) || !action ? null : href ? (
						<Button asChild>
							<a href={href} target="_blank" rel="noopener noreferrer">
								{action}
								<ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
							</a>
						</Button>
					) : (
						<Button asChild>
							<Link to={to}>{action}</Link>
						</Button>
					)}
					{children}
				</div>
			) : null}
		</div>
	);
}

export { EmptyState };
