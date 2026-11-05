import { decamelizeKeys } from "src/api/backend/caseConvert";
import { AppModal, Button, ErrorAlert, EventFormatter, GravatarFormatter, Loading } from "src/components";
import { useAuditLog } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showEventDetailsModal = (id) => {
	EasyModal.show(EventDetailsModal, { id });
};

const EventDetailsModal = EasyModal.create(({ id, visible, remove }) => {
	const { data, isPending, error } = useAuditLog(id);

	return (
		<AppModal show={visible} onHide={remove} size="lg" scrollable>
			<AppModal.Header closeButton>
				<AppModal.Title>
					<T id="action.view-details" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				{error ? <ErrorAlert error={error} /> : null}
				{isPending ? <Loading noLogo /> : null}
				{data ? (
					<>
						<div className="mb-3 flex flex-wrap items-center gap-3">
							<GravatarFormatter url={data.user?.avatar} name={data.user?.name} />
							<EventFormatter row={data} />
						</div>
						{/* pre-wrap wraps long values instead of scrolling sideways */}
						<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-sm">
							{JSON.stringify(decamelizeKeys(data.meta), null, 2)}
						</pre>
					</>
				) : null}
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={remove}>
					<T id="action.close" />
				</Button>
			</AppModal.Footer>
		</AppModal>
	);
});

export { showEventDetailsModal };
