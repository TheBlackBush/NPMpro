import { Menu, Search } from "lucide-react";
import { Button } from "src/components/Button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "src/components/ui/input-group";
import { Kbd } from "src/components/ui/kbd";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { Logo } from "src/shell/Logo";
import { ThemeMenu } from "src/shell/ThemeMenu";
import { TokenControl } from "./TokenControl";

/**
 * The route search. Escape clears it.
 *
 * @param {Object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {React.Ref<HTMLInputElement>} [props.inputRef]
 * @param {boolean} [props.shortcut]  shows the "/" key hint
 * @param {string} [props.className]
 */
export function SearchInput({ value, onChange, inputRef, shortcut = false, className }) {
	const label = intl.formatMessage({ id: "api-reference.search" });
	return (
		<InputGroup className={className}>
			<InputGroupAddon>
				<Search aria-hidden="true" />
			</InputGroupAddon>
			<InputGroupInput
				ref={inputRef}
				type="search"
				value={value}
				placeholder={label}
				aria-label={label}
				autoComplete="off"
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						onChange("");
					}
				}}
			/>
			{shortcut ? (
				<InputGroupAddon align="inline-end">
					<Kbd>/</Kbd>
				</InputGroupAddon>
			) : null}
		</InputGroup>
	);
}

/**
 * The brand bar and the sticky header: logo back to the app, the title, the version, the search (from lg; below it
 * the search is in the nav sheet) and the theme menu
 *
 * @param {Object} props
 * @param {string} props.version
 * @param {string} props.query
 * @param {(value: string) => void} props.onQuery
 * @param {React.Ref<HTMLInputElement>} props.searchRef
 * @param {() => void} props.onOpenNav  opens the route list on a phone
 */
export function ApiHeader({ version, query, onQuery, searchRef, onOpenNav }) {
	return (
		<>
			<div className="h-[3px] bg-linear-to-r from-[#ff8a00] via-[#d91aff] to-[#00d1ff]" aria-hidden="true" />
			<header className="sticky top-0 z-30 flex h-14 min-w-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="lg:hidden"
					aria-label={intl.formatMessage({ id: "api-reference.open-nav" })}
					onClick={onOpenNav}
				>
					<Menu aria-hidden="true" />
				</Button>
				<Logo alt={intl.formatMessage({ id: "api-reference.back" })} />
				<h1 className="m-0 whitespace-nowrap font-semibold text-base">
					<T id="api-reference.title" />
				</h1>
				{version ? (
					<span className="whitespace-nowrap rounded-full border bg-muted px-2 py-0.5 font-mono text-muted-foreground text-xs">
						{version}
					</span>
				) : null}
				<div className="min-w-0 flex-1" />
				<SearchInput
					value={query}
					onChange={onQuery}
					inputRef={searchRef}
					shortcut
					className={cn("hidden w-72 lg:flex")}
				/>
				<TokenControl />
				<ThemeMenu />
			</header>
		</>
	);
}
