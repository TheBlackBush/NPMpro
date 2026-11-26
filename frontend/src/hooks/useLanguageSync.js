import { useEffect, useRef } from "react";
import { updateMyLanguage } from "src/api/backend";
import { currentLocale } from "src/locale";
import { languageNeedsSync } from "src/modules/LanguageSync";
import { useUser } from "./useUser";

/**
 * Sends the UI language to the server once per page load, after /users/me is loaded and only when it differs from the
 * stored one. A language switch reloads the page, so this covers each sign-in and each switch. A failed call is not
 * repeated and does not show anything: the next page load tries again.
 */
const useLanguageSync = () => {
	const { data } = useUser("me");
	const sent = useRef(false);
	useEffect(() => {
		if (sent.current || !languageNeedsSync(data, currentLocale)) return;
		sent.current = true;
		updateMyLanguage(currentLocale).catch(() => undefined);
	}, [data]);
};

export { useLanguageSync };
