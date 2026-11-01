import { IconWorld } from "@tabler/icons-react";
import cn from "clsx";
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
	// a thin themable edge (Tabler's border colour), so a white flag (Japan) does not melt into a light background
	return <FlagElement title={countryCode} className={cn("border rounded-1", className)} width={20} />;
}

export { Flag };
