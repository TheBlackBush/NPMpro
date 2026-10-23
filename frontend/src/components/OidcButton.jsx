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
import { contrastText } from "src/modules/Oidc";

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
		return <img src={icon.url} alt="" width={20} height={20} className="icon" />;
	}
	const Icon = OIDC_ICON_COMPONENTS[icon?.name] ?? IconLogin;
	return <Icon className="icon" aria-hidden="true" />;
}

function OidcButton({ label, color, icon, onClick, disabled }) {
	return (
		<button
			type="button"
			className="btn w-100"
			// inline because the provider colour is a setting (any hex), so no Tabler colour class can express it
			style={{ backgroundColor: color, borderColor: color, color: contrastText(color) }}
			onClick={onClick}
			disabled={disabled}
		>
			<OidcIcon icon={icon} />
			<T id="login.oidc-sign-in" data={{ label }} />
		</button>
	);
}

export { OIDC_ICON_COMPONENTS, OidcButton, OidcIcon };
