import { CircleUser, Cloud, KeyRound, LayoutGrid, Lock, LogIn, ShieldCheck } from "lucide-react";
import {
	siAuth0,
	siAuthelia,
	siAuthentik,
	siGitea,
	siGithub,
	siGitlab,
	siGoogle,
	siKeycloak,
	siOkta,
	siOpenid,
} from "simple-icons";

const generic = (name, icon) => ({
	name,
	kind: "generic",
	labelKey: `settings.authentication.button.icon.${name}`,
	icon,
});
const brand = (name, icon) => ({ name, kind: "brand", label: icon.title, icon });

/**
 * The built-in sign-in button icons, in picker order. The names are what the OIDC settings store.
 * Generic icons are Lucide components, brand icons Simple Icons objects ({ title, path, hex }).
 * "brand-windows" is kept for settings saved earlier (Simple Icons has no Windows logo): it shows the Lucide
 * grid icon and is hidden from the picker.
 * Licences: not all of these logos are CC0 (Authelia Apache-2.0, Keycloak custom trademark
 * terms); when adding or bumping an icon, check its `license` field in simple-icons/data/simple-icons.json and
 * update the credits in wiki/Authentication.md.
 */
const OIDC_ICONS = [
	generic("login", LogIn),
	generic("key", KeyRound),
	generic("lock", Lock),
	generic("shield-lock", ShieldCheck),
	generic("user-circle", CircleUser),
	generic("cloud", Cloud),
	brand("brand-authentik", siAuthentik),
	brand("brand-authelia", siAuthelia),
	brand("brand-keycloak", siKeycloak),
	brand("brand-okta", siOkta),
	brand("brand-auth0", siAuth0),
	brand("brand-openid", siOpenid),
	brand("brand-google", siGoogle),
	brand("brand-github", siGithub),
	brand("brand-gitlab", siGitlab),
	brand("brand-gitea", siGitea),
	{ name: "brand-windows", kind: "generic", label: "Windows", hidden: true, icon: LayoutGrid },
];

const OIDC_PICKER_ICONS = OIDC_ICONS.filter((entry) => !entry.hidden);

const BY_NAME = new Map(OIDC_ICONS.map((entry) => [entry.name, entry]));

/**
 * The entry for a stored icon name; an unknown name gives the login icon
 */
const oidcIcon = (name) => BY_NAME.get(name) ?? BY_NAME.get("login");

export { OIDC_ICONS, OIDC_PICKER_ICONS, oidcIcon };
