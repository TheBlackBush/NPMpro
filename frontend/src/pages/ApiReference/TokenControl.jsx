import { KeyRound } from "lucide-react";
import { useContext, useState } from "react";
import { Button } from "src/components/ui/button";
import { Input } from "src/components/ui/input";
import { Label } from "src/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { intl, T } from "src/locale";
import { TOKEN_PREFIX } from "src/modules/ApiRequest";
import { TryAuthContext } from "./TryAuthContext";

/**
 * The header control of Try it: paste an API token to run routes as that token. The token lives in the page state
 * only (gone on reload) and the field is cleared as soon as it is taken.
 */
export function TokenControl() {
	const { token, setToken } = useContext(TryAuthContext);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [invalid, setInvalid] = useState(false);

	const label = token
		? intl.formatMessage(
				{ id: "api-reference.token-active" },
				{ short: token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8) },
			)
		: intl.formatMessage({ id: "api-reference.token-use" });

	const onOpenChange = (next) => {
		setOpen(next);
		setDraft("");
		setInvalid(false);
	};

	const apply = (event) => {
		event.preventDefault();
		const value = draft.trim();
		if (!value.startsWith(TOKEN_PREFIX)) {
			setInvalid(true);
			return;
		}
		setToken(value);
		onOpenChange(false);
	};

	const clear = () => {
		setToken("");
		onOpenChange(false);
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={label}
					title={label}
					data-token-open=""
					className="max-md:size-8 max-md:p-0"
				>
					<KeyRound aria-hidden="true" />
					<span className="hidden font-mono md:inline">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80" data-token-popover="">
				{token ? (
					<Button type="button" variant="outline" size="sm" onClick={clear}>
						<T id="api-reference.token-clear" />
					</Button>
				) : (
					<form className="flex flex-col gap-2.5" onSubmit={apply}>
						<Label htmlFor="api-reference-token">
							<T id="api-reference.token-label" />
						</Label>
						<Input
							id="api-reference-token"
							type="password"
							value={draft}
							autoComplete="off"
							spellCheck={false}
							aria-invalid={invalid}
							aria-describedby="api-reference-token-help"
							onChange={(event) => {
								setDraft(event.target.value);
								setInvalid(false);
							}}
						/>
						{invalid ? (
							<p className="m-0 text-destructive text-xs" role="alert">
								<T id="api-reference.token-invalid" />
							</p>
						) : null}
						<p id="api-reference-token-help" className="m-0 text-muted-foreground text-xs">
							<T id="api-reference.token-help" />
						</p>
						<Button type="submit" size="sm">
							<T id="api-reference.token-apply" />
						</Button>
					</form>
				)}
			</PopoverContent>
		</Popover>
	);
}
