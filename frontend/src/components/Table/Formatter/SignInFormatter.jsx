import { TapTooltip } from "src/components/TapTooltip";
import { Badge } from "src/components/ui/badge";
import { formatDateTime, T } from "src/locale";
import { signInMethods } from "src/modules/SignInMethods";

// Local: the user has a password; OIDC: linked to an OIDC identity, the tooltip gives the link date
export function SignInFormatter({ user }) {
	const methods = signInMethods(user);
	if (methods.length === 0) return <span className="text-muted-foreground">-</span>;
	return (
		<span className="inline-flex flex-wrap gap-1">
			{methods.map((method) =>
				method === "oidc" ? (
					<TapTooltip
						key={method}
						content={
							<T
								id="user.sign-in.oidc-linked-on"
								data={{ date: formatDateTime(user.npmproOidcLinkedOn) }}
							/>
						}
					>
						<Badge variant="secondary">
							<T id="user.sign-in.oidc" />
						</Badge>
					</TapTooltip>
				) : (
					<Badge key={method} variant="secondary">
						<T id="user.sign-in.local" />
					</Badge>
				),
			)}
		</span>
	);
}
