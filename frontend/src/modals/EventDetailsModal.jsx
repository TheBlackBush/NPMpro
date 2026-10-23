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
		<AppModal show={visible} onHide={remove}>
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<>
					<AppModal.Header closeButton>
						<AppModal.Title>
							<T id="action.view-details" />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<div className="row">
							<div className="col-md-2">
								<GravatarFormatter url={data.user?.avatar} />
							</div>
							<div className="col-md-10">
								<EventFormatter row={data} />
							</div>
							<hr className="mt-4 mb-3" />
							<textarea
								className="form-control font-monospace"
								spellCheck={false}
								rows={9}
								readOnly
								value={JSON.stringify(decamelizeKeys(data.meta), null, 2)}
							/>
						</div>
					</AppModal.Body>
					<AppModal.Footer>
						<Button className="ms-auto" onClick={remove}>
							<T id="action.close" />
						</Button>
					</AppModal.Footer>
				</>
			)}
		</AppModal>
	);
});

export { showEventDetailsModal };
