import { Fragment } from "react";
import { hostParts } from "src/modules/HostBreak";

// a break opportunity after each dot, colon and @ (or the given separators), so a long host name or e-mail address
// wraps at its labels instead of widening a table column
export function BreakableHost({ value, separators }) {
	let offset = 0;
	return hostParts(value, separators).map((part) => {
		const key = offset;
		offset += part.length;
		return (
			<Fragment key={key}>
				{key > 0 ? <wbr /> : null}
				{part}
			</Fragment>
		);
	});
}
