import { createIntl } from "react-intl";
import localeList from "translations/lang-list.json" with { type: "json" };
import en from "translations/ui/en.json" with { type: "json" };

// English is in the startup chunk: the other languages fill their empty values from it. Each other language is a
// chunk of its own, fetched at startup for the chosen one only (changeLocale reloads the page).
const uiFiles = import.meta.glob(["../../translations/ui/*.json", "!../../translations/ui/en.json"], {
	import: "default",
});

const localeOptions = ["en", ...Object.keys(localeList).filter((locale) => locale !== "en" && !localeList[locale].rtl)];

const storedLocale = window.localStorage.getItem("locale");
const currentLocale = localeOptions.includes(storedLocale) ? storedLocale : "en";

document.documentElement.lang = currentLocale;

// a language whose chunk cannot be fetched (a deploy replaced the files under an open tab) shows English
const loadMessages = async (locale) => {
	if (locale === "en") return {};
	try {
		return await uiFiles[`../../translations/ui/${locale}.json`]();
	} catch {
		return {};
	}
};

const own = await loadMessages(currentLocale);

const intl = createIntl({
	locale: currentLocale,
	messages: {
		...en,
		...Object.fromEntries(Object.entries(own).filter(([, value]) => value)),
	},
});

const changeLocale = (lang) => {
	window.localStorage.setItem("locale", lang);
	location.reload();
};

// Wraps the translation in a span with a data attribute holding the translation ID
const T = ({ id, data, tData }) => {
	const translatedData = {};
	if (tData) {
		for (const [key, value] of Object.entries(tData)) {
			translatedData[key] = intl.formatMessage({ id: value });
		}
	}
	return (
		<span data-translation-id={id}>
			{intl.formatMessage(
				{ id },
				{
					...data,
					...translatedData,
				},
			)}
		</span>
	);
};

export { changeLocale, currentLocale, intl, localeOptions, T };
