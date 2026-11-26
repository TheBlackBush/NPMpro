import { useEffect, useRef } from "react";
import { updateMyLanguage } from "src/api/backend";
import { currentLocale } from "src/locale";
import { createLanguageSync } from "src/modules/LanguageSync";
import { useUser } from "./useUser";

/**
 * Sends the UI language to the server once per page load, after /users/me is loaded and only when it differs from the
 * stored one. A language switch reloads the page, so this covers each sign-in and each switch.
 */
const useLanguageSync = () => {
	const { data } = useUser("me");
	const sync = useRef(null);
	useEffect(() => {
		sync.current ??= createLanguageSync(currentLocale, updateMyLanguage);
		sync.current(data);
	}, [data]);
};

export { useLanguageSync };
