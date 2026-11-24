import { ChevronDown, Plus } from "lucide-react";
import { useRef } from "react";
import { Button, HasPermission } from "src/components";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { useDdnsSuggestions } from "src/hooks";
import { T } from "src/locale";
import { showDdnsRecordModal } from "src/modals";
import { recordPrefill, suggestionChoice } from "src/modules/DdnsSuggestions";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";

// the record window opens once the menu has closed and returned focus, as the row action menus do
const openLater = (suggestion) => setTimeout(() => showDdnsRecordModal(undefined, recordPrefill(suggestion)), 0);

/** Host names that could be kept updated: "{count} host names could be kept updated" and Add (a list when several) */
export function SuggestionsBar() {
	const { data } = useDdnsSuggestions();
	const pending = useRef(null);
	const choice = suggestionChoice(data);
	if (choice.kind === "none") return null;
	return (
		<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
			<div
				className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
				data-ddns-suggestions={data.length}
			>
				<span>
					<T id="ddns.suggestions.count" data={{ count: data.length }} />
				</span>
				{choice.kind === "one" ? (
					<Button
						type="button"
						color="primary"
						size="sm"
						onClick={() => showDdnsRecordModal(undefined, recordPrefill(choice.first))}
					>
						<Plus data-icon="inline-start" aria-hidden="true" />
						<T id="ddns.suggestions.add" />
					</Button>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button type="button" color="primary" size="sm">
								<Plus data-icon="inline-start" aria-hidden="true" />
								<T id="ddns.suggestions.add" />
								<ChevronDown data-icon="inline-end" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="max-h-80 w-72"
							onCloseAutoFocus={() => {
								const chosen = pending.current;
								pending.current = null;
								if (chosen) openLater(chosen);
							}}
						>
							<DropdownMenuLabel>
								<T id="ddns.suggestions.choose" />
							</DropdownMenuLabel>
							{data.map((entry) => (
								<DropdownMenuItem
									key={entry.name}
									onSelect={() => {
										pending.current = entry;
									}}
								>
									<span className="flex min-w-0 flex-col">
										<span className="wrap-anywhere">{entry.name}</span>
										<span className="text-xs text-muted-foreground">{entry.credentialName}</span>
									</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</HasPermission>
	);
}
