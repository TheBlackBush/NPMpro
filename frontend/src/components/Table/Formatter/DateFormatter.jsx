import { formatDateTime } from "src/locale";

export function DateFormatter({ value }) {
	return <span>{formatDateTime(value)}</span>;
}
