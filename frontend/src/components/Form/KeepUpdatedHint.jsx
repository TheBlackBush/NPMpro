import { RefreshCw } from "lucide-react";
import { Button } from "src/components/ui/button";
import { useCanManage, useDdnsSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { recordPrefill, suggestionsFor } from "src/modules/DdnsSuggestions";
import { CERTIFICATES } from "src/modules/Permissions";

/**
 * The names of a host that the server suggests keeping updated, by lower case name. The server suggests names of saved
 * hosts that no Dynamic DNS record has yet and that a credential of the user could update, so a name only typed in the
 * window has an entry only when another saved host has it too. The server suggests at most 100 names, so a name past
 * that cap has none (accepted). Empty without Certificates manage.
 *
 * @param   {string[]} names  the names of the host window
 * @returns {Map<string, Object>}
 */
export function useKeepUpdated(names) {
	const canManage = useCanManage(CERTIFICATES);
	const { data: suggestions } = useDdnsSuggestions({ enabled: canManage });
	const found = canManage ? suggestionsFor(names, suggestions) : [];
	return new Map(found.map((entry) => [entry.name.toLowerCase(), entry]));
}

/**
 * A "Keep updated" button beside a name: it opens the record window with the name and the credential filled in. Input
 * help only.
 *
 * @param {Object} props
 * @param {Object} props.entry  a suggestion of useKeepUpdated
 * @param {(id?: number, prefill?: Object) => void} props.onOpen  opens the record window (showDdnsRecordModal)
 */
export function KeepUpdatedButton({ entry, onOpen }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="xs"
			data-keep-updated
			aria-label={intl.formatMessage({ id: "ddns.suggestions.keep-updated-name" }, { name: entry.name })}
			onClick={() => onOpen(undefined, recordPrefill(entry))}
		>
			<RefreshCw data-icon="inline-start" aria-hidden="true" />
			<T id="ddns.suggestions.keep-updated" />
		</Button>
	);
}
