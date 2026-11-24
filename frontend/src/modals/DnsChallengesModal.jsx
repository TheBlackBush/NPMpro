import { Eraser } from "lucide-react";
import { useEffect, useState } from "react";
import { AppModal, Button, ErrorAlert, Loading, NoticeAlert } from "src/components";
import { TapTooltip } from "src/components/TapTooltip";
import { Badge } from "src/components/ui/badge";
import { Checkbox } from "src/components/ui/checkbox";
import { useDeleteDnsChallenges, useDnsChallenges } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import {
	ageText,
	canDelete,
	deleteBody,
	hasUnknownAge,
	initialSelection,
	keepSelection,
	resultCounts,
	resultLine,
	shortValue,
} from "src/modules/DnsChallenges";
import EasyModal from "src/modules/easyModal";
import { sectionAccent } from "src/modules/SectionAccents";
import { showError, showSuccess, showWarning } from "src/notifications";

const accent = sectionAccent("dnsCredentials");

/**
 * The challenge cleanup window of a DNS credential: the leftover _acme-challenge TXT records with a box each, a
 * confirmation step (nothing is deleted before it) and the result per record. Records of unknown age are never ticked
 * in advance.
 */
const showDnsChallengesModal = ({ credentialId, credentialName }) => {
	EasyModal.show(DnsChallengesModal, { credentialId, credentialName });
};

const TONE_CLASSES = {
	success: "text-success",
	muted: "text-muted-foreground",
	warning: "text-warning",
	destructive: "text-destructive",
};

function Values({ values }) {
	return (
		<div className="min-w-0 text-sm text-muted-foreground">
			{values.length === 0 ? (
				<span>-</span>
			) : (
				values.map((value) => (
					<TapTooltip key={value} content={value}>
						<code className="block max-w-full wrap-anywhere">
							<span aria-hidden="true">{shortValue(value)}</span>
							<span className="sr-only">{value}</span>
						</code>
					</TapTooltip>
				))
			)}
		</div>
	);
}

function ChallengeRow({ item, checked, busy, onChange }) {
	const id = `dns-challenge-${item.key}`;
	const age = ageText(item.ageSeconds);
	return (
		<li className="flex items-start gap-3 px-3 py-2" data-challenge-key={item.key}>
			<Checkbox
				id={id}
				className="mt-1"
				checked={checked}
				disabled={busy}
				aria-describedby={`${id}-info`}
				onCheckedChange={(value) => onChange(item.key, value === true)}
			/>
			<div className="min-w-0 flex-1">
				<label htmlFor={id} className="block wrap-anywhere font-medium">
					{item.name}
				</label>
				<Values values={item.values} />
				<div id={`${id}-info`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
					<span className={cn(!Number.isInteger(item.ageSeconds) && "text-warning")}>
						<T id={age.id} data={age.values} />
					</span>
					{busy ? (
						<Badge variant="outline" className="border-warning text-warning">
							<T id="dns-challenges.state.in-use" />
						</Badge>
					) : null}
					{item.recent ? (
						<Badge variant="outline" className="border-warning text-warning">
							<T id="dns-challenges.state.recent" />
						</Badge>
					) : null}
				</div>
			</div>
		</li>
	);
}

function Results({ results, items }) {
	const names = new Map((items ?? []).map((item) => [item.key, item.name]));
	return (
		<ul
			aria-label={intl.formatMessage({ id: "dns-challenges.results" })}
			className="m-0 list-none divide-y overflow-y-auto rounded-md border p-0"
			data-challenge-results=""
		>
			{results.map((entry) => {
				const line = resultLine(entry);
				return (
					<li key={entry.key} className="px-3 py-2" data-challenge-result={entry.result}>
						<div className="wrap-anywhere font-medium">{entry.name ?? names.get(entry.key)}</div>
						<div className={cn("text-sm wrap-anywhere", TONE_CLASSES[line.tone])}>
							<T id={line.id} />
							{line.detail ? `: ${line.detail}` : ""}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

const DnsChallengesModal = EasyModal.create(({ credentialId, credentialName, visible, remove }) => {
	const { data: answer, error, isFetching } = useDnsChallenges(credentialId);
	const { mutateAsync: deleteChallenges, isPending } = useDeleteDnsChallenges(credentialId);
	const [selection, setSelection] = useState(new Set());
	const [step, setStep] = useState("list");
	const [results, setResults] = useState(null);
	const [deleteError, setDeleteError] = useState(null);

	const items = answer?.items ?? [];
	const busy = answer?.busy === true;
	const name = credentialName || `#${credentialId}`;

	// each answer starts with its old records ticked (never while a request runs, never an unknown age); ticks the
	// user made stay on a list that is read again
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new answer resets the ticks
	useEffect(() => {
		if (!answer) return;
		setSelection((prev) =>
			step === "list" && results === null && prev.size === 0
				? initialSelection(answer.items, answer.busy === true)
				: keepSelection(prev, answer.items, answer.busy === true),
		);
	}, [answer]);

	const onToggle = (key, on) => {
		setSelection((prev) => {
			const next = new Set(prev);
			if (on) next.add(key);
			else next.delete(key);
			return next;
		});
	};

	const onDelete = async () => {
		if (isPending) return;
		setDeleteError(null);
		try {
			const { results: done } = await deleteChallenges(deleteBody(items, selection));
			const counts = resultCounts(done);
			const text = intl.formatMessage({ id: "dns-challenges.toast" }, counts);
			if (counts.ok) showSuccess(text);
			else if (counts.failed > 0 && counts.deleted + counts.gone === 0) showError(text);
			else showWarning(text);
			setResults(done);
			setSelection(new Set());
			setStep("results");
		} catch (err) {
			// a busy instance or a missing lock: nothing was deleted, the list is read again and the window says why
			setDeleteError(err);
			setStep("list");
		}
	};

	const backToList = () => {
		setResults(null);
		setStep("list");
	};

	const unsupported = answer && answer.supported === false;
	const noDomains = typeof answer?.errorI18n === "string" && answer.errorI18n !== "";
	const empty = answer && !unsupported && !noDomains && items.length === 0;
	const showList = answer && !unsupported && !noDomains && items.length > 0;
	const selectedCount = selection.size;
	const unknownTicked = hasUnknownAge(items, selection);
	const unknownAny = hasUnknownAge(items);
	const recentAny = items.some((item) => item.recent);

	return (
		<AppModal
			show={visible}
			onHide={isPending ? undefined : remove}
			size="lg"
			scrollable
			data-dns-challenges-window
		>
			<AppModal.Header closeButton={!isPending}>
				<AppModal.Title className="flex items-center gap-2">
					<Eraser className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" />
					<T id="dns-challenges.title" data={{ credential: name }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert error={error} />
				<ErrorAlert error={deleteError} onClose={() => setDeleteError(null)} />
				<div role="status" aria-live="polite">
					{isFetching && !answer && !error ? (
						<>
							<Loading noLogo />
							<span className="sr-only">
								<T id="loading" />
							</span>
						</>
					) : null}
					{unsupported ? (
						<p className="mb-0 text-muted-foreground">
							<T id="dns-challenges.unsupported" />
						</p>
					) : null}
					{noDomains ? (
						<p className="mb-0 text-muted-foreground">
							<T id={answer.errorI18n} />
						</p>
					) : null}
					{empty && step === "list" ? (
						<p className="mb-0 text-muted-foreground">
							<T id="dns-challenges.empty" />
						</p>
					) : null}
				</div>
				{answer && busy && step === "list" ? (
					<NoticeAlert className="mb-3" data-challenge-busy="">
						<T id="dns-challenges.busy" />
					</NoticeAlert>
				) : null}
				{step === "results" && results ? <Results results={results} items={items} /> : null}
				{step === "confirm" ? (
					<div data-challenge-confirm="">
						<p className="font-medium">
							<T id="dns-challenges.confirm.question" data={{ count: selectedCount, credential: name }} />
						</p>
						<ul className="m-0 max-h-72 list-none divide-y overflow-y-auto rounded-md border p-0">
							{items
								.filter((item) => selection.has(item.key))
								.map((item) => (
									<li key={item.key} className="wrap-anywhere px-3 py-2">
										{item.name}
									</li>
								))}
						</ul>
						{unknownTicked ? (
							<NoticeAlert className="mt-3">
								<T id="dns-challenges.unknown-age" />
							</NoticeAlert>
						) : null}
					</div>
				) : null}
				{showList && step === "list" ? (
					<>
						<p className="text-sm text-muted-foreground">
							<T id="dns-challenges.intro" />
						</p>
						{unknownAny ? (
							<NoticeAlert className="mb-3" data-challenge-unknown-age="">
								<T id="dns-challenges.unknown-age" />
							</NoticeAlert>
						) : null}
						{recentAny ? (
							<p className="text-sm text-muted-foreground">
								<T id="dns-challenges.recent-note" />
							</p>
						) : null}
						{answer.truncated ? (
							<p className="text-sm text-muted-foreground">
								<T id="dns-challenges.truncated" />
							</p>
						) : null}
						<ul
							aria-label={intl.formatMessage({ id: "dns-challenges.list" })}
							className="m-0 list-none divide-y overflow-y-auto rounded-md border p-0"
						>
							{items.map((item) => (
								<ChallengeRow
									key={item.key}
									item={item}
									checked={selection.has(item.key)}
									busy={busy}
									onChange={onToggle}
								/>
							))}
						</ul>
					</>
				) : null}
				{answer?.skippedCnames > 0 && step === "list" ? (
					<p className="mt-3 mb-0 text-sm text-muted-foreground">
						<T id="dns-challenges.cnames" data={{ count: answer.skippedCnames }} />
					</p>
				) : null}
			</AppModal.Body>
			<AppModal.Footer>
				{step === "list" ? (
					<>
						<Button variant="ghost" onClick={remove}>
							<T id="cancel" />
						</Button>
						{showList ? (
							<Button
								variant="destructive"
								disabled={!canDelete(selection, busy)}
								onClick={() => setStep("confirm")}
							>
								<T id="dns-challenges.delete" data={{ count: selectedCount }} />
							</Button>
						) : null}
					</>
				) : null}
				{step === "confirm" ? (
					<>
						<Button variant="ghost" onClick={() => setStep("list")} disabled={isPending}>
							<T id="dns-challenges.back" />
						</Button>
						<Button
							variant="destructive"
							onClick={onDelete}
							disabled={isPending || !canDelete(selection, busy)}
						>
							<T id="dns-challenges.delete" data={{ count: selectedCount }} />
						</Button>
					</>
				) : null}
				{step === "results" ? (
					<>
						<Button variant="ghost" onClick={backToList}>
							<T id="dns-challenges.to-list" />
						</Button>
						<Button onClick={remove}>
							<T id="action.close" />
						</Button>
					</>
				) : null}
			</AppModal.Footer>
		</AppModal>
	);
});

export { showDnsChallengesModal };
