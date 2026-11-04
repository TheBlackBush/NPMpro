import { BrandIcon } from "src/components/BrandIcon";
import { T } from "src/locale";
import { contrastText, shade, validOidcColor } from "src/modules/Oidc";
import { oidcIcon } from "src/modules/OidcIcons";

function OidcIcon({ icon }) {
	if (icon?.type === "file") {
		return <img src={icon.url} alt="" width={20} height={20} className="size-5 shrink-0" />;
	}
	const entry = oidcIcon(icon?.name);
	if (entry.kind === "brand") return <BrandIcon icon={entry.icon} className="size-5 shrink-0" />;
	const Icon = entry.icon;
	return <Icon className="size-5 shrink-0" aria-hidden="true" />;
}

function OidcButton({ label, color, icon, onClick, disabled }) {
	const bg = validOidcColor(color);
	const text = contrastText(bg);
	const hover = shade(bg, 0.1);
	const active = shade(bg, 0.2);
	return (
		<button
			type="button"
			className="inline-flex w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded-md border border-(--oidc-bg) bg-(--oidc-bg) min-h-9 px-3 py-1.5 font-medium text-(--oidc-fg) text-sm outline-none transition-colors hover:border-(--oidc-hover) hover:bg-(--oidc-hover) focus-visible:ring-3 focus-visible:ring-ring/50 active:border-(--oidc-active) active:bg-(--oidc-active) disabled:pointer-events-none disabled:opacity-50"
			// the provider colour is a setting (any hex), so no utility class can express it: only CSS custom
			// properties are set here (through the CSSOM, allowed by the CSP) and the classes above read them
			style={{
				"--oidc-bg": bg,
				"--oidc-fg": text,
				"--oidc-hover": hover,
				"--oidc-active": active,
			}}
			onClick={onClick}
			disabled={disabled}
		>
			<OidcIcon icon={icon} />
			<span className="min-w-0 wrap-anywhere">
				<T id="login.oidc-sign-in" data={{ label }} />
			</span>
		</button>
	);
}

export { OidcButton, OidcIcon };
