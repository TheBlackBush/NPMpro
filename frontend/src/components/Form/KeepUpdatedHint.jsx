import { RefreshCw } from "lucide-react";
import { useWatch } from "react-hook-form";
import { Button } from "src/components/ui/button";
import { useCanManage, useDdnsSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { recordPrefill, suggestionsFor } from "src/modules/DdnsSuggestions";
import { CERTIFICATES } from "src/modules/Permissions";

/**
 * Under the domain names of a host window: a "Keep updated" button beside each name of the window that the server
 * suggests. The server suggests names of saved hosts that no Dynamic DNS record has yet and that a credential of the
 * user could update, so a name only typed in the window gets a button only when another saved host has it too. It
 * opens the record window with the name and the credential filled in. The server suggests at most 100 names, so a
 * name past that cap gets no hint (accepted).
 * Input help only: nothing shows without a suggestion or without Certificates manage.
 *
 * @param {Object} props
 * @param {(id?: number, prefill?: Object) => void} props.onOpen  opens the record window (showDdnsRecordModal)
 */
export function KeepUpdatedHint({ onOpen }) {
	const names = useWatch({ name: "domainNames" });
	const canManage = useCanManage(CERTIFICATES);
	const { data: suggestions } = useDdnsSuggestions({ enabled: canManage });
	const found = canManage ? suggestionsFor(names, suggestions) : [];
	if (found.length === 0) return null;
	return (
		<ul className="mb-3 flex list-none flex-col gap-1 p-0 text-sm" data-keep-updated>
			{found.map((entry) => (
				<li key={entry.name} className="flex flex-wrap items-center gap-2">
					<span className="font-mono wrap-anywhere">{entry.name}</span>
					<Button
						type="button"
						variant="outline"
						size="xs"
						aria-label={intl.formatMessage(
							{ id: "ddns.suggestions.keep-updated-name" },
							{ name: entry.name },
						)}
						onClick={() => onOpen(undefined, recordPrefill(entry))}
					>
						<RefreshCw data-icon="inline-start" aria-hidden="true" />
						<T id="ddns.suggestions.keep-updated" />
					</Button>
				</li>
			))}
		</ul>
	);
}
