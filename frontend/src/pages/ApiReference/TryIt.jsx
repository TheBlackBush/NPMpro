import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "src/components/ui/button";
import { Input } from "src/components/ui/input";
import { Label } from "src/components/ui/label";
import { Textarea } from "src/components/ui/textarea";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { buildTryRequest, formatAnswer } from "src/modules/ApiRequest";
import { CodeBlock } from "./CodeBlock";
import { TryAuthContext } from "./TryAuthContext";

const MISSING = "missing-path:";

const initialValues = (operation, where) =>
	Object.fromEntries(
		operation.params
			.filter((param) => param.in === where)
			.map((param) => [param.name, where === "path" && param.example !== undefined ? String(param.example) : ""]),
	);

const initialBody = (operation) =>
	operation.body?.mediaType === "application/json" ? JSON.stringify(operation.body.example ?? {}, null, 2) : "";

// The answer of the server as text for the code block; a redirect shows its target when the browser lets us read it
const readAnswer = async (response) => {
	const contentType = response.headers.get("content-type") ?? "";
	const type = contentType.split(";")[0].trim().toLowerCase();
	if (type === "application/json" || type.endsWith("+json") || type.startsWith("text/") || contentType === "") {
		const text = await response.text();
		return text === "" ? null : formatAnswer({ contentType: contentType || "text/plain", text });
	}
	const blob = await response.blob();
	return formatAnswer({ contentType, size: blob.size });
};

function Field({ id, label, required, error, children }) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id} className="font-mono text-xs">
				{label}
				{required ? <span className="text-destructive"> *</span> : null}
			</Label>
			{children}
			{error ? (
				<p className="m-0 text-destructive text-xs" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

const MERGE_MODE = /"mode"\s*:\s*"merge"/u;

// A DELETE, or a restore that replaces (the default mode), needs the token's Allow delete switch
const needsAllowDelete = (operation, bodyText) =>
	operation.method === "DELETE" ||
	(operation.method === "POST" && operation.path === "/backups/restore/{token}" && !MERGE_MODE.test(bodyText));

function Result({ result, token, operation, bodyText }) {
	if (result.failure) {
		return <p className="m-0 text-destructive text-sm">{result.failure}</p>;
	}
	const ok = result.status >= 200 && result.status < 300;
	return (
		<div className="flex flex-col gap-2">
			<p className="m-0 flex flex-wrap items-center gap-2 text-sm">
				<span
					className={cn(
						"font-mono font-semibold",
						ok ? "text-green-600 dark:text-green-400" : "text-destructive",
					)}
				>
					{result.redirect ? "3xx" : result.status} {result.statusText}
				</span>
				<span className="text-muted-foreground">
					{intl.formatMessage({ id: "api-reference.duration" }, { ms: result.ms })}
				</span>
			</p>
			{result.redirect ? (
				<p className="m-0 text-muted-foreground text-xs">
					<T id="api-reference.try-redirect" />
					{result.location ? <span className="font-mono"> {result.location}</span> : null}
				</p>
			) : null}
			{result.status === 403 && token ? (
				<p className="m-0 text-muted-foreground text-xs">
					<T
						id={
							needsAllowDelete(operation, bodyText)
								? "api-reference.try-forbidden-delete"
								: "api-reference.try-forbidden"
						}
					/>
				</p>
			) : null}
			{result.answer ? (
				<CodeBlock text={result.answer.text} language={result.answer.kind === "json" ? "json" : "shell"} />
			) : null}
		</div>
	);
}

/**
 * Try it for one route: a button that opens the parameters and the body and sends the request only when the user
 * presses Send (a second time for a method that changes data). It runs as the signed-in session or, with a pasted
 * token, as that token. It never touches the app's own session.
 *
 * @param {Object} props
 * @param {object} props.operation  a route of the reference view model
 */
export function TryIt({ operation }) {
	const { token } = useContext(TryAuthContext);
	const [open, setOpen] = useState(false);
	const [pathValues, setPathValues] = useState(() => initialValues(operation, "path"));
	const [queryValues, setQueryValues] = useState(() => initialValues(operation, "query"));
	const [bodyText, setBodyText] = useState(() => initialBody(operation));
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);
	const controller = useRef(null);

	const method = operation.method;
	const changes = method !== "GET";
	const hasBody = operation.body?.mediaType === "application/json";
	const idBase = `try-${operation.anchor}`;

	useEffect(() => () => controller.current?.abort(), []);

	const close = () => {
		controller.current?.abort();
		controller.current = null;
		setOpen(false);
		setConfirm(false);
		setBusy(false);
		setError(null);
		setResult(null);
	};

	// A different token is a different caller: the confirmation and the old answer no longer apply
	// biome-ignore lint/correctness/useExhaustiveDependencies: the token is the trigger, not a value read here
	useEffect(() => {
		setConfirm(false);
		setResult(null);
	}, [token]);

	if (operation.body && !operation.body.tryable) {
		return (
			<p className="m-0 text-muted-foreground text-xs">
				<T id="api-reference.try-not-json" />
			</p>
		);
	}

	const send = async () => {
		if (changes && !confirm) {
			setConfirm(true);
			return;
		}
		const missing = operation.params.find(
			(param) => param.in === "query" && param.required && !queryValues[param.name]?.trim(),
		);
		if (missing) {
			setError({
				field: `q-${missing.name}`,
				message: intl.formatMessage({ id: "api-reference.try-missing" }, { name: missing.name }),
			});
			return;
		}
		let request;
		try {
			request = buildTryRequest({
				operation,
				values: pathValues,
				query: queryValues,
				bodyText: hasBody ? bodyText : "",
				token,
			});
		} catch (caught) {
			const text = caught instanceof Error ? caught.message : "";
			if (text.startsWith(MISSING)) {
				const name = text.slice(MISSING.length);
				setError({
					field: `p-${name}`,
					message: intl.formatMessage({ id: "api-reference.try-missing" }, { name }),
				});
			} else {
				setError({ field: "body", message: intl.formatMessage({ id: "api-reference.try-invalid-json" }) });
			}
			return;
		}
		setError(null);
		setResult(null);
		setConfirm(false);
		setBusy(true);
		controller.current?.abort();
		const own = new AbortController();
		controller.current = own;
		const started = performance.now();
		try {
			const response = await fetch(request.url, { ...request.init, signal: own.signal });
			const ms = Math.round(performance.now() - started);
			const redirect = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
			const answer = redirect ? null : await readAnswer(response);
			if (own.signal.aborted) {
				return;
			}
			setResult({
				status: response.status,
				statusText: response.statusText,
				ms,
				answer,
				redirect,
				location: redirect ? response.headers.get("location") : null,
			});
		} catch (caught) {
			if (!own.signal.aborted) {
				setResult({
					failure: intl.formatMessage(
						{ id: "api-reference.try-network" },
						{ message: caught instanceof Error ? caught.message : "" },
					),
				});
			}
		} finally {
			if (controller.current === own) {
				controller.current = null;
				setBusy(false);
			}
		}
	};

	const pathParams = operation.params.filter((param) => param.in === "path");
	const queryParams = operation.params.filter((param) => param.in === "query");

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-muted-foreground text-xs">
					<T id={token ? "api-reference.try-as-token" : "api-reference.try-as-session"} />
				</span>
				{open ? null : (
					<Button type="button" size="sm" data-try-open="" onClick={() => setOpen(true)}>
						<T id="api-reference.try" />
					</Button>
				)}
			</div>
			{open ? (
				<div className="flex flex-col gap-3" data-try-panel="">
					{pathParams.map((param) => (
						<Field
							key={param.name}
							id={`${idBase}-p-${param.name}`}
							label={param.name}
							required
							error={error?.field === `p-${param.name}` ? error.message : null}
						>
							<Input
								id={`${idBase}-p-${param.name}`}
								value={pathValues[param.name] ?? ""}
								autoComplete="off"
								spellCheck={false}
								onChange={(event) => setPathValues({ ...pathValues, [param.name]: event.target.value })}
							/>
						</Field>
					))}
					{queryParams.map((param) => (
						<Field
							key={param.name}
							id={`${idBase}-q-${param.name}`}
							label={param.name}
							required={param.required}
							error={error?.field === `q-${param.name}` ? error.message : null}
						>
							<Input
								id={`${idBase}-q-${param.name}`}
								value={queryValues[param.name] ?? ""}
								autoComplete="off"
								spellCheck={false}
								onChange={(event) =>
									setQueryValues({ ...queryValues, [param.name]: event.target.value })
								}
							/>
						</Field>
					))}
					{hasBody ? (
						<Field
							id={`${idBase}-body`}
							label={intl.formatMessage({ id: "api-reference.try-body" })}
							error={error?.field === "body" ? error.message : null}
						>
							<Textarea
								id={`${idBase}-body`}
								rows={10}
								className="font-mono text-xs"
								spellCheck={false}
								value={bodyText}
								onChange={(event) => setBodyText(event.target.value)}
							/>
						</Field>
					) : null}
					{confirm ? (
						<p className="m-0 text-destructive text-xs" role="alert">
							<T id="api-reference.try-confirm" />
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant={confirm ? "destructive" : "default"}
							disabled={busy}
							data-try-send=""
							onClick={send}
						>
							{busy ? <T id="api-reference.sending" /> : null}
							{!busy && confirm ? <T id="api-reference.send-method" data={{ method }} /> : null}
							{!busy && !confirm ? <T id="api-reference.send" /> : null}
						</Button>
						<Button type="button" size="sm" variant="ghost" data-try-cancel="" onClick={close}>
							<T id="api-reference.cancel" />
						</Button>
					</div>
					<div aria-live="polite" data-try-result={result ? "" : undefined}>
						{result ? (
							<Result result={result} token={token} operation={operation} bodyText={bodyText} />
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
