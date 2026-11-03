import {
	IconBrandGithub,
	IconBrandGitlab,
	IconBrandGoogle,
	IconBrandWindows,
	IconCloud,
	IconKey,
	IconLock,
	IconLogin,
	IconShieldLock,
	IconUserCircle,
} from "@tabler/icons-react";
import { T } from "src/locale";
import { contrastText, shade, validOidcColor } from "src/modules/Oidc";

// Keys are the names stored in the OIDC settings (OIDC_BUILTIN_ICONS in modules/Oidc.js)
const OIDC_ICON_COMPONENTS = {
	key: IconKey,
	lock: IconLock,
	login: IconLogin,
	"shield-lock": IconShieldLock,
	"user-circle": IconUserCircle,
	"brand-google": IconBrandGoogle,
	"brand-github": IconBrandGithub,
	"brand-gitlab": IconBrandGitlab,
	"brand-windows": IconBrandWindows,
	cloud: IconCloud,
};

function OidcIcon({ icon }) {
	if (icon?.type === "file") {
		return <img src={icon.url} alt="" width={20} height={20} className="size-5 shrink-0" />;
	}
	const Icon = OIDC_ICON_COMPONENTS[icon?.name] ?? IconLogin;
	return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}

function OidcButton({ label, color, icon, onClick, disabled }) {
	const bg = validOidcColor(color);
	const text = contrastText(bg);
	const hover = shade(bg, 0.1);
	const active = shade(bg, 0.2);
	return (
		<button
			type="button"
			className="inline-flex w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded-md border border-(--oidc-bg) bg-(--oidc-bg) px-3 py-2 font-medium text-(--oidc-fg) text-sm outline-none transition-colors hover:border-(--oidc-hover) hover:bg-(--oidc-hover) focus-visible:ring-3 focus-visible:ring-ring/50 active:border-(--oidc-active) active:bg-(--oidc-active) disabled:pointer-events-none disabled:opacity-50"
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

export { OIDC_ICON_COMPONENTS, OidcButton, OidcIcon };
