import { ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "src/components/Button";
import { Flag } from "src/components/Flag";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "src/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { intl, T } from "src/locale";
import { COUNTRY_CODES, countryName, searchCountries } from "src/modules/Countries";

/**
 * A combobox that adds countries: a button that opens a searchable list (names in the UI language, with their flag).
 * The codes already chosen are left out. The list closes after a pick.
 *
 * @param {Object}   props
 * @param {string[]} props.value     the codes already chosen
 * @param {Function} props.onAdd     (code) => void
 * @param {boolean}  [props.disabled]
 */
function CountryPicker({ value, onAdd, disabled = false }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const codes = useMemo(() => {
		const chosen = new Set(value);
		return COUNTRY_CODES.filter((code) => !chosen.has(code));
	}, [value]);
	const found = useMemo(() => searchCountries(query, intl.locale, codes), [query, codes]);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			<PopoverTrigger asChild>
				<Button className="self-start" disabled={disabled} role="combobox" aria-expanded={open}>
					<T id="access-list.countries.add" />
					<ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-0">
				<Command shouldFilter={false}>
					<CommandInput
						value={query}
						onValueChange={setQuery}
						aria-label={intl.formatMessage({ id: "access-list.countries.search" })}
						placeholder={intl.formatMessage({ id: "access-list.countries.search" })}
					/>
					<CommandList>
						{found.length === 0 ? (
							<CommandEmpty>
								<T id="access-list.countries.none-found" />
							</CommandEmpty>
						) : null}
						{found.map((code) => (
							<CommandItem
								key={code}
								value={code}
								onSelect={() => {
									onAdd(code);
									setOpen(false);
									setQuery("");
								}}
							>
								<Flag countryCode={code} tooltip={false} />
								<span className="min-w-0 flex-1 truncate">{countryName(code, intl.locale)}</span>
								<span className="text-muted-foreground text-xs">{code}</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

export { CountryPicker };
