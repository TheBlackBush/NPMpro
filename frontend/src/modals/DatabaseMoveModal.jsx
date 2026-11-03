import { useQueryClient } from "@tanstack/react-query";
import cn from "clsx";
import { Check, Database, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { getDatabase, getHealth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormField } from "src/components";
import { Input } from "src/components/ui/input";
import { Progress } from "src/components/ui/progress";
import { useDatabaseMove, useStartDatabaseMove } from "src/hooks";
import { intl, T } from "src/locale";
import {
	activeStep,
	canCloseMove,
	copyProgress,
	failedStepOf,
	MOVE_STEPS,
	moveAsApiError,
	moveLost,
	moveView,
	pollStalled,
	resolveMoveEnd,
	stepName,
	stepState,
	totals,
	whereText,
} from "src/modules/DatabaseMove";
import EasyModal from "src/modules/easyModal";
import { StatusAlert } from "src/pages/Settings/StatusAlert";

/**
 * @param {Object}  props
 * @param {Object}  props.status  GET /database: the database in use and its tables
 * @param {Object}  props.target  the target payload (toPayload) of the tested form values
 * @param {string}  [props.moveId]  a running move to follow: the window opens on its progress
 */
const showDatabaseMoveModal = (props) => {
	EasyModal.show(DatabaseMoveModal, props);
};

const engineLabel = (engine) => intl.formatMessage({ id: `settings.database.engine.${engine}` });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function StepMarker({ state }) {
	if (state === "done") return <Check className="size-4 shrink-0 text-success" aria-hidden="true" />;
	if (state === "failed") return <X className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
	return (
		// the icon's width, so the step names line up
		<span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
			<span
				className={cn(
					"size-2 rounded-full",
					state === "active" ? "bg-success motion-safe:animate-pulse" : "bg-muted-foreground/50",
				)}
			/>
		</span>
	);
}

function CopyProgress({ tables }) {
	const progress = copyProgress(tables);
	return (
		<div className="mt-2">
			<Progress value={progress.percent} aria-label={intl.formatMessage({ id: "settings.database.step.copy" })} />
			{progress.current ? (
				<div className="mt-1 text-sm break-words text-muted-foreground">
					<T
						id="settings.database.move.table-progress"
						data={{
							table: progress.current.name,
							copied: intl.formatNumber(progress.current.copied),
							rows: intl.formatNumber(progress.current.rows),
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

// the steps of the move, each with its state; the copy step shows the rows copied so far
function StepList({ move }) {
	return (
		<ol className="divide-y rounded-md border">
			{MOVE_STEPS.map((step) => {
				const state = stepState(move, step);
				const label = intl.formatMessage({ id: `settings.database.step.${step}` });
				return (
					<li key={step} className="px-3 py-2" aria-current={state === "active" ? "step" : undefined}>
						<div className="flex items-center gap-2">
							<StepMarker state={state} />
							<span
								className={cn(
									state === "pending" && "text-muted-foreground",
									state === "active" && "font-medium",
								)}
							>
								{label}
							</span>
						</div>
						{step === "copy" && (state === "active" || state === "done") ? (
							<CopyProgress tables={move?.tables ?? []} />
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

function Summary({ status, target }) {
	const sums = totals(status.tables);
	const values = {
		tables: intl.formatNumber(sums.tables),
		rows: intl.formatNumber(sums.rows),
		from: engineLabel(status.engine),
	};
	if (target.engine === "sqlite") return <T id="settings.database.move.summary-sqlite" data={values} />;
	const to = intl.formatMessage(
		{ id: "settings.database.move.to" },
		{ engine: engineLabel(target.engine), where: whereText(target) },
	);
	return <T id="settings.database.move.summary" data={{ ...values, to }} />;
}

const stepLabel = (step) => stepName(step, (id) => intl.formatMessage({ id }));

/**
 * The move window: the summary with a typed confirmation, then the steps with the copy progress, the restart wait
 * and the reload, or the failure. Leaving the page does not stop a move; the Database section opens it again.
 */
const DatabaseMoveModal = EasyModal.create(({ status, target, moveId: followed, visible, remove }) => {
	const queryClient = useQueryClient();
	const startMove = useStartDatabaseMove();
	const baseId = useId();
	const wordId = `${baseId}-word`;
	const [moveId, setMoveId] = useState(followed ?? null);
	const [word, setWord] = useState("");
	const [error, setError] = useState(null);
	// null while the polls tell the state; "resolving" when they cannot (they failed for 10 s, or the move vanished
	// from them); "restarting" while the new process is awaited; "timeout" after 2 minutes without an answer
	const [phase, setPhase] = useState(null);
	// the failed move from GET /database, when the polls could not report the failure
	const [resolved, setResolved] = useState(null);
	// the last answer of the polls about this window's move
	const [seen, setSeen] = useState(null);
	// failed polls count from the last answer or from when the polls started or resumed
	const [resumedAt, setResumedAt] = useState(() => Date.now());
	const [, setTick] = useState(0);
	const resolving = useRef(false);
	// one POST even for a fast double submit, before isPending is rendered
	const startSent = useRef(false);
	const wordRef = useRef(null);
	const titleRef = useRef(null);
	const actionRef = useRef(null);
	// no polls while the end is resolved or awaited
	const moveQuery = useDatabaseMove(Boolean(moveId) && phase === null && !resolved);
	const polled = moveQuery.data?.move ?? null;
	const own = polled?.id === moveId ? polled : null;
	const move = resolved ?? own ?? seen;
	const view = moveView({ moveId, move, pollFailed: moveQuery.isError });
	const closable = canCloseMove(view, phase);
	const engine = target?.engine ?? move?.target?.engine ?? "";
	const matches = word.trim() === engine;
	const active = view === "running" ? activeStep(move) : null;
	const connectionLost = phase === "resolving" || (view === "running" && moveQuery.isError);
	const ended = view === "failed" || phase === "timeout";
	const lost = moveLost({ seen: Boolean(seen), answered: moveQuery.isSuccess, move: polled, moveId });
	const stalled =
		(view === "running" || view === "starting") &&
		pollStalled({
			isError: moveQuery.isError,
			lastAnswerAt: Math.max(moveQuery.dataUpdatedAt, resumedAt),
			now: Date.now(),
		});

	useEffect(() => {
		if (own) setSeen(own);
	}, [own]);

	// while polls fail, render every second so the 10 s without an answer are noticed on time
	useEffect(() => {
		if (!moveQuery.isError || phase !== null) return;
		const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
		return () => clearInterval(timer);
	}, [moveQuery.isError, phase]);

	// after the start the confirmation's field is gone: the focus goes to the title, above the steps
	useEffect(() => {
		if (view === "starting") titleRef.current?.focus();
	}, [view]);

	// the failure and the timeout end with one button: Close or Reload
	useEffect(() => {
		if (ended) actionRef.current?.focus();
	}, [ended]);

	// the end of the move, when the polls cannot tell it: the health check, then GET /database decide
	useEffect(() => {
		const restarting = view === "restarting";
		if (!moveId || phase !== null || resolved || resolving.current || !(restarting || stalled || lost)) return;
		resolving.current = true;
		setPhase(restarting ? "restarting" : "resolving");
		const resolve = async () => {
			const end = await resolveMoveEnd({
				moveId,
				expectRestart: restarting,
				fetchHealth: getHealth,
				fetchDatabase: getDatabase,
				sleep,
				now: Date.now,
			});
			if (end.result === "restarted") {
				// the restart may sign everyone out (unless COOKIE_SECRET is set), so the reload may show the login
				window.location.reload();
				return;
			}
			if (end.result === "failed") setResolved(end.move);
			if (end.result === "timeout") {
				setPhase("timeout");
				return;
			}
			if (end.result === "running") {
				// the old process still runs the move: the polls go on after a pause, failures count from then
				await sleep(2000);
				setResumedAt(Date.now());
			}
			resolving.current = false;
			setPhase(null);
		};
		void resolve();
	}, [view, moveId, phase, resolved, stalled, lost]);

	const close = () => {
		if (!closable) return;
		remove();
		if (view === "failed") {
			for (const queryKey of [["database"], ["database-move"], ["health"]]) {
				void queryClient.invalidateQueries({ queryKey });
			}
		}
	};

	const onStart = async (event) => {
		event.preventDefault();
		if (!matches || startSent.current) return;
		startSent.current = true;
		setError(null);
		try {
			const { id } = await startMove.mutateAsync(target);
			setResumedAt(Date.now());
			setMoveId(id);
			// the banner on every page, and the first poll of this move
			void queryClient.invalidateQueries({ queryKey: ["health"] });
			void queryClient.invalidateQueries({ queryKey: ["database-move"] });
		} catch (err) {
			setError(err);
			startSent.current = false;
		}
	};

	let body;
	let footer;
	if (view === "confirm") {
		body = (
			<form id={`${baseId}-form`} onSubmit={onStart} noValidate>
				<p className="mb-3 text-muted-foreground">
					<Summary status={status} target={target} />
				</p>
				<FormField
					id={wordId}
					label={intl.formatMessage(
						{ id: "settings.database.move.confirm" },
						{ word: <code key="word">{engine}</code> },
					)}
					required
					className="mb-0"
				>
					{(control) => (
						<Input
							{...control}
							ref={wordRef}
							value={word}
							onChange={(event) => setWord(event.target.value)}
							required
							autoComplete="off"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
							autoFocus
						/>
					)}
				</FormField>
				{error ? (
					<ErrorAlert className="mt-3" onClose={() => setError(null)}>
						<ApiErrorContent error={error} />
					</ErrorAlert>
				) : null}
			</form>
		);
		footer = (
			<>
				<Button variant="ghost" onClick={close} disabled={startMove.isPending}>
					<T id="cancel" />
				</Button>
				<Button
					type="submit"
					form={`${baseId}-form`}
					color="primary"
					className="ms-auto"
					isLoading={startMove.isPending}
					blocked={!matches}
					onBlockedClick={() => wordRef.current?.focus()}
					aria-describedby={matches ? undefined : `${wordId}-label`}
				>
					<T id="settings.database.move.start" />
				</Button>
			</>
		);
	} else {
		body = (
			<>
				<StepList move={view === "starting" ? null : move} />
				{/* the active step's name, for screen readers: the list itself is not a live region */}
				<div className="sr-only" aria-live="polite">
					{active ? stepLabel(active) : ""}
				</div>
				{connectionLost ? (
					<div className="mt-3 text-sm text-muted-foreground" role="status">
						<T id="settings.database.move.connection-lost" />
					</div>
				) : null}
				{move?.backup && view !== "starting" ? (
					<div className="mt-3 text-sm break-words text-muted-foreground">
						<T id="settings.database.move.backup-name" data={{ name: move.backup }} />
					</div>
				) : null}
				{/* always mounted, so the restart and its end are announced */}
				<div aria-live="polite">
					{phase === "restarting" ? (
						<div className="mt-3 flex items-start gap-2">
							<Loader2
								className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
							<div>
								<div className="font-medium">
									<T id="settings.database.move.restarting" />
								</div>
								<div className="text-muted-foreground">
									<T id="settings.database.move.sign-in" />
								</div>
							</div>
						</div>
					) : null}
					{phase === "timeout" ? (
						<StatusAlert variant="warning" icon={TriangleAlert} className="mt-3" live={false}>
							<T id="settings.database.move.restart-timeout" />
						</StatusAlert>
					) : null}
				</div>
				{view === "failed" ? (
					<>
						<ErrorAlert className="mt-3">
							<ApiErrorContent error={moveAsApiError(move?.error)} />
						</ErrorAlert>
						<p className="mt-3">
							<T id="settings.database.move.failed" data={{ step: stepLabel(failedStepOf(move)) }} />
						</p>
					</>
				) : null}
			</>
		);
		if (view === "failed") {
			footer = (
				<Button ref={actionRef} className="ms-auto" onClick={close}>
					<T id="action.close" />
				</Button>
			);
		} else if (phase === "timeout") {
			footer = (
				<Button ref={actionRef} color="primary" className="ms-auto" onClick={() => window.location.reload()}>
					<RefreshCw aria-hidden="true" />
					<T id="settings.database.move.reload" />
				</Button>
			);
		} else {
			footer = null;
		}
	}

	return (
		<AppModal show={visible} onHide={close} size="lg" backdrop={closable ? true : "static"} keyboard={closable}>
			<AppModal.Header closeButton={closable}>
				<AppModal.Title ref={titleRef} tabIndex={-1} className="flex items-center gap-2">
					<Database className="size-5 shrink-0" aria-hidden="true" />
					<T id="settings.database.move.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>{body}</AppModal.Body>
			{footer ? <AppModal.Footer>{footer}</AppModal.Footer> : null}
		</AppModal>
	);
});

export { showDatabaseMoveModal };
