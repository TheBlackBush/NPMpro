import { helpDocPath } from "src/modules/HelpDocPath";
import { currentLocale } from "./IntlProvider.jsx";

// One loader per document: each becomes its own chunk, fetched when its window opens
const helpDocs = import.meta.glob("../../translations/help/*/*.md", {
	import: "default",
	query: "?raw",
});

export const getHelpFile = async (section) => {
	const path = helpDocPath(currentLocale, section, helpDocs);
	if (!path) throw new Error(`Cannot load help doc for ${currentLocale}-${section}`);
	return await helpDocs[path]();
};
