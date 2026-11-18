import { useEffect, useMemo, useRef, useState } from "react";
import { Loading } from "src/components";
import { Alert } from "src/components/ui/alert";
import { Button } from "src/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "src/components/ui/sheet";
import { useApiSchema } from "src/hooks";
import { intl, T } from "src/locale";
import { buildReference, filterReference, legacyAnchor } from "src/modules/ApiReference";
import { ApiGroup } from "./ApiGroup";
import { ApiHeader, SearchInput } from "./ApiHeader";
import { ApiNav } from "./ApiNav";
import { CodeLanguageContext } from "./CodePanel";
import { GuideSheet } from "./GuideSheet";
import { QuickStart } from "./QuickStart";
import { elementById, useScrollSpy } from "./useScrollSpy";

const HASH_MARK = /^#/u;

const decodeHash = (hash) => {
	try {
		return decodeURIComponent(hash.replace(HASH_MARK, ""));
	} catch {
		return "";
	}
};

// Scrolls to the element a hash names; an old Swagger hash is rewritten to its new anchor first
const goToHash = (reference) => {
	const { hash } = window.location;
	let element = hash ? elementById(decodeHash(hash)) : null;
	if (!element && hash) {
		const anchor = legacyAnchor(decodeHash(hash) ? `#${decodeHash(hash)}` : hash, reference);
		if (anchor) {
			window.history.replaceState(null, "", `#${anchor}`);
			element = elementById(anchor);
		}
	}
	element?.scrollIntoView({ block: "start" });
};

const isTyping = (target) =>
	target instanceof HTMLElement && (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable);

/** The API reference page: outside the app shell, with its own header and route list */
export default function ApiReference() {
	const { data, error, isPending, refetch } = useApiSchema();
	const [query, setQuery] = useState("");
	const [navOpen, setNavOpen] = useState(false);
	const [guideOpen, setGuideOpen] = useState(false);
	const [language, setLanguage] = useState("curl");
	const codeLanguage = useMemo(() => ({ language, setLanguage }), [language]);
	const openGuide = () => setGuideOpen(true);
	const searchRef = useRef(null);

	const reference = useMemo(() => (data ? buildReference(data) : null), [data]);
	const shown = useMemo(() => (reference ? filterReference(reference, query) : null), [reference, query]);
	const ids = useMemo(
		() =>
			shown
				? ["getting-started", ...shown.groups.flatMap((g) => [g.name, ...g.operations.map((o) => o.anchor)])]
				: [],
		[shown],
	);
	const active = useScrollSpy(ids);

	// the deep link, once the reference is rendered, and later hash changes
	const ready = reference !== null;
	useEffect(() => {
		if (!ready) {
			return;
		}
		const go = () => goToHash(reference);
		go();
		window.addEventListener("hashchange", go);
		return () => window.removeEventListener("hashchange", go);
	}, [ready, reference]);

	// "/" focuses the search unless the focus is in a field
	useEffect(() => {
		const onKey = (event) => {
			if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
				event.preventDefault();
				searchRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	const searching = query.trim() !== "";
	const nav = shown ? (
		<ApiNav
			reference={shown}
			active={active}
			query={query}
			showStart={!searching}
			onNavigate={() => setNavOpen(false)}
		/>
	) : null;

	return (
		<CodeLanguageContext.Provider value={codeLanguage}>
			<div className="min-h-svh bg-background text-foreground">
				<a
					href="#reference"
					className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-md"
				>
					<T id="api-reference.skip" />
				</a>
				<ApiHeader
					version={reference?.version ?? ""}
					query={query}
					onQuery={setQuery}
					searchRef={searchRef}
					onOpenNav={() => setNavOpen(true)}
				/>
				<Sheet open={navOpen} onOpenChange={setNavOpen}>
					<SheetContent side="left" className="w-72 p-0 lg:hidden" aria-describedby={undefined}>
						<SheetHeader className="border-b">
							<SheetTitle>
								<T id="api-reference.nav" />
							</SheetTitle>
						</SheetHeader>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="p-3 pb-0">
								<SearchInput value={query} onChange={setQuery} />
							</div>
							{nav}
						</div>
					</SheetContent>
				</Sheet>
				<div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
					<aside className="sticky top-[calc(3.5rem+3px)] hidden h-[calc(100svh-3.5rem-3px)] overflow-y-auto border-r bg-sidebar lg:block">
						{nav}
					</aside>
					<main id="reference" tabIndex={-1} className="min-w-0 outline-none">
						{isPending ? <Loading noLogo /> : null}
						{error ? (
							<div className="p-6">
								<Alert variant="destructive" className="flex items-center gap-3">
									<span className="flex-1">
										<T id="api-reference.load-error" data={{ message: error.message }} />
									</span>
									<Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
										<T id="api-reference.retry" />
									</Button>
								</Alert>
							</div>
						) : null}
						{shown && !searching ? <QuickStart reference={reference} onOpenGuide={openGuide} /> : null}
						{shown && searching && shown.groups.length === 0 ? (
							<p className="m-0 p-6 text-muted-foreground text-sm" role="status">
								{intl.formatMessage({ id: "api-reference.search-empty" }, { query })}
							</p>
						) : null}
						{shown?.groups.map((group) => (
							<ApiGroup key={group.name} group={group} onOpenGuide={openGuide} />
						))}
					</main>
				</div>
				{reference ? <GuideSheet open={guideOpen} onOpenChange={setGuideOpen} text={reference.guide} /> : null}
			</div>
		</CodeLanguageContext.Provider>
	);
}
