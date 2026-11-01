const helpDocFolder = "../../translations/help";

// The path of the help document to load: the locale's own, else the English one, else null
export const helpDocPath = (locale, section, available) => {
	for (const code of [locale, "en"]) {
		const path = `${helpDocFolder}/${code}/${section}.md`;
		if (Object.hasOwn(available, path)) return path;
	}
	return null;
};
