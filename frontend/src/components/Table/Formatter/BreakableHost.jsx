import { Fragment } from "react";

const HOST_BREAK = /(?<=[.:])/u;
// a break opportunity after each dot and colon, so a long host name wraps at its labels instead of
// widening a table column
export function BreakableHost({ value }) {
	let offset = 0;
	return value.split(HOST_BREAK).map((part) => {
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
