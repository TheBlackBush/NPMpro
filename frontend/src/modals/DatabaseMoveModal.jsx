import { IconCheck, IconRefresh, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import cn from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { getHealth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert } from "src/components";
import { useDatabaseMove, useStartDatabaseMove } from "src/hooks";
import { intl, T } from "src/locale";
import {
	activeStep,
	canCloseMove,
	copyProgress,
	failedStepOf,
	MOVE_STEPS,
	moveAsApiError,
	moveView,
	stepState,
	totals,
	waitForRestart,
	whereText,
} from "src/modules/DatabaseMove";
import EasyModal from "src/modules/easyModal";

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
	if (state === "done") return <IconCheck className="icon text-success" aria-hidden="true" />;
	if (state === "failed") return <IconX className="icon text-danger" aria-hidden="true" />;
	return (
		// the icon's width, so the step names line up
		<span className="icon d-inline-flex align-items-center justify-content-center" aria-hidden="true">
			<span
				className={cn(
					"status-dot",
					state === "active" ? "status-dot-animated status-green" : "status-secondary",
				)}
			/>
		</span>
	);
}

function CopyProgress({ tables }) {
	const progress = copyProgress(tables);
	return (
		<div className="mt-2">
			<div
				className="progress progress-sm"
				role="progressbar"
				aria-valuenow={progress.percent}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={intl.formatMessage({ id: "settings.database.step.copy" })}
			>
				{/* width is the data value: Tabler sets progress bar widths inline, no utility covers any percentage */}
				<div className="progress-bar" style={{ width: `${progress.percent}%` }} />
			</div>
			{progress.current ? (
				<div className="small text-secondary mt-1 text-break">
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
		<div className="list-group list-group-flush border-top border-bottom">
			{MOVE_STEPS.map((step) => {
				const state = stepState(move, step);
				const label = intl.formatMessage({ id: `settings.database.step.${step}` });
				return (
					<div key={step} className="list-group-item" aria-current={state === "active" ? "step" : undefined}>
						<div className="d-flex align-items-center gap-2">
							<StepMarker state={state} />
							<span
								className={cn(
									state === "pending" && "text-secondary",
									state === "active" && "fw-medium",
								)}
							>
								{label}
							</span>
						</div>
						{step === "copy" && (state === "active" || state === "done") ? (
							<CopyProgress tables={move?.tables ?? []} />
						) : null}
					</div>
				);
			})}
		</div>
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

// the name of a step, or the raw step when the backend sends one this build does not know
const stepLabel = (step) =>
	MOVE_STEPS.includes(step) ? intl.formatMessage({ id: `settings.database.step.${step}` }) : (step ?? "");

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
	// null until the restart, then "waiting" for the new process, then "timeout" after 2 minutes
	const [restart, setRestart] = useState(null);
	const waitStarted = useRef(false);
	// one POST even for a fast double submit, before isPending is rendered
	const startSent = useRef(false);
	const wordRef = useRef(null);
	const titleRef = useRef(null);
	const actionRef = useRef(null);
	// no polls once the restart wait runs: the old process is gone
	const moveQuery = useDatabaseMove(Boolean(moveId) && restart === null);
	const move = moveQuery.data?.move ?? null;
	const view = moveView({ moveId, move, pollFailed: moveQuery.isError });
	const closable = canCloseMove(view, restart);
	const engine = target?.engine ?? move?.target?.engine ?? "";
	const matches = word.trim() === engine;
	const active = view === "running" ? activeStep(move) : null;
	const connectionLost = view === "running" && moveQuery.isError;
	const ended = view === "failed" || restart === "timeout";

	// after the start the confirmation's field is gone: the focus goes to the title, above the steps
	useEffect(() => {
		if (view === "starting") titleRef.current?.focus();
	}, [view]);

	// the failure and the timeout end with one button: Close or Reload
	useEffect(() => {
		if (ended) actionRef.current?.focus();
	}, [ended]);

	useEffect(() => {
		if (view !== "restarting" || waitStarted.current) return;
		waitStarted.current = true;
		setRestart("waiting");
		const wait = async () => {
			const result = await waitForRestart({ fetchHealth: getHealth, sleep, now: Date.now });
			// the restart signs everyone out (unless COOKIE_SECRET is set), so the reload usually shows the login
			if (result === "ready") window.location.reload();
			else setRestart("timeout");
		};
		void wait();
	}, [view]);

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
				<p className="text-secondary">
					<Summary status={status} target={target} />
				</p>
				<label htmlFor={wordId} id={`${wordId}-label`} className="form-label">
					{intl.formatMessage(
						{ id: "settings.database.move.confirm" },
						{ word: <code key="word">{engine}</code> },
					)}
				</label>
				<input
					id={wordId}
					ref={wordRef}
					className="form-control"
					value={word}
					onChange={(event) => setWord(event.target.value)}
					autoComplete="off"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					// biome-ignore lint/a11y/noAutofocus: the only field of a confirmation window
					autoFocus
				/>
				{error ? (
					<ErrorAlert className="mt-3 mb-0" onClose={() => setError(null)}>
						<ApiErrorContent error={error} />
					</ErrorAlert>
				) : null}
			</form>
		);
		footer = (
			<>
				<Button onClick={close} disabled={startMove.isPending}>
					<T id="cancel" />
				</Button>
				<Button
					type="submit"
					form={`${baseId}-form`}
					color="warning"
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
				<div className="mb-3">
					<StepList move={view === "starting" ? null : move} />
				</div>
				{/* the active step's name, for screen readers: the list itself is not a live region */}
				<div className="visually-hidden" aria-live="polite">
					{active ? stepLabel(active) : ""}
				</div>
				{connectionLost ? (
					<div className="small text-secondary mb-3" role="status">
						<T id="settings.database.move.connection-lost" />
					</div>
				) : null}
				{move?.backup && view !== "starting" ? (
					<div className="small text-secondary text-break mb-3">
						<T id="settings.database.move.backup-name" data={{ name: move.backup }} />
					</div>
				) : null}
				{/* always mounted, so the restart and its end are announced */}
				<div aria-live="polite">
					{restart === "waiting" ? (
						<div className="d-flex align-items-start gap-2">
							<span className="spinner-border spinner-border-sm mt-1 flex-shrink-0" aria-hidden="true" />
							<div>
								<div className="fw-medium">
									<T id="settings.database.move.restarting" />
								</div>
								<div className="text-secondary">
									<T id="settings.database.move.sign-in" />
								</div>
							</div>
						</div>
					) : null}
					{restart === "timeout" ? (
						<div className="alert alert-warning mb-0">
							<T id="settings.database.move.restart-timeout" />
						</div>
					) : null}
				</div>
				{view === "failed" ? (
					<>
						<ErrorAlert className="mb-3">
							<ApiErrorContent error={moveAsApiError(move?.error)} />
						</ErrorAlert>
						<p className="mb-0">
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
		} else if (restart === "timeout") {
			footer = (
				<Button ref={actionRef} color="primary" className="ms-auto" onClick={() => window.location.reload()}>
					<IconRefresh className="icon" aria-hidden="true" />
					<T id="settings.database.move.reload" />
				</Button>
			);
		} else {
			footer = null;
		}
	}

	return (
		<AppModal show={visible} onHide={close} size="lg" backdrop={closable ? true : "static"} keyboard={closable}>
			<div className={cn("modal-status", view === "failed" ? "bg-danger" : "bg-warning")} />
			<AppModal.Header closeButton={closable}>
				<AppModal.Title ref={titleRef} tabIndex={-1}>
					<T id="settings.database.move.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>{body}</AppModal.Body>
			{footer ? <AppModal.Footer>{footer}</AppModal.Footer> : null}
		</AppModal>
	);
});

export { showDatabaseMoveModal };
