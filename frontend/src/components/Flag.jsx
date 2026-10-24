import { IconWorld } from "@tabler/icons-react";
// @ts-expect-error Creating a typing for a subfolder is not easily possible
import Flags from "country-flag-icons/react/3x2";

function Flag({ className, countryCode }) {
	if (countryCode === "EN") {
		return <IconWorld className={className} width={20} />;
	}

	const FlagElement = Flags[countryCode];
	// codes without a flag (unknown or reserved ones such as XK) render nothing instead of throwing
	if (!FlagElement) {
		return null;
	}
	return <FlagElement title={countryCode} className={className} width={20} />;
}

export { Flag };
