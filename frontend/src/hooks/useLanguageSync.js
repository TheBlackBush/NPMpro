import { useEffect, useRef } from "react";
import { updateMyLanguage } from "src/api/backend";
import { chosenLocale } from "src/locale";
import { createLanguageSync } from "src/modules/LanguageSync";
import { useUser } from "./useUser";

/**
 * Sends the chosen UI language to the server once per page load, after /users/me is loaded and only when it differs
 * from the stored one. A user who never chose a language sends nothing, so the default mail language applies. A
 * language switch stores the choice and reloads the page, so the new language is sent right after the switch.
 */
const useLanguageSync = () => {
	const { data } = useUser("me");
	const sync = useRef(null);
	useEffect(() => {
		sync.current ??= createLanguageSync(chosenLocale, updateMyLanguage);
		sync.current(data);
	}, [data]);
};

export { useLanguageSync };
