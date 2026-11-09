import errs from "../lib/error.js";
import { castJsonIfNeed } from "../lib/helpers.js";
import { cleanStreamData, streamsConflict } from "../lib/stream-rules.js";
import streamModel from "../models/stream.js";
import createHostService from "./host-service.js";

/**
 * An incoming port is unique per protocol (nginx refuses a second listen). Only enabled streams count, and every
 * owner's streams are checked, not only the caller's. `ownId` is the stream being updated.
 */
const assertPortFree = async (stream, ownId) => {
	if (!stream.enabled) return;
	const query = streamModel.query().where("enabled", 1);
	if (ownId) query.whereNot("id", ownId);
	const clash = (await query).find((other) => streamsConflict(stream, other));
	if (clash) {
		throw new errs.ValidationError(
			`Another stream already uses the incoming port ${clash.incoming_port} for the same protocol. A port can be used once for TCP and once for UDP.`,
		);
	}
};

const LISTEN_FIELDS = ["tcp_forwarding", "udp_forwarding", "enabled"];

const internalStream = createHostService({
	type: { hostType: "stream", auditType: "stream", permission: "streams", takenType: null, label: "Stream" },
	model: streamModel,
	expand: ["certificate"],
	hooks: {
		// the stored row is merged into the payload before anything else, so it is loaded first
		loadExistingFirst: true,
		prepareCreate: (data) => cleanStreamData(data),
		prepareUpdate: (data, existingRow) => cleanStreamData(data, existingRow),
		assertFreeOnCreate: (data) => assertPortFree({ ...data, enabled: data.enabled ?? true }),
		// a save that keeps the listener passes on a row that already duplicates another
		assertFreeOnUpdate: async (data, existingRow) => {
			const changesListen =
				data.incoming_port !== existingRow.incoming_port ||
				LISTEN_FIELDS.some((field) => Boolean(data[field]) !== Boolean(existingRow[field]));
			if (changesListen) await assertPortFree(data, data.id);
		},
		assertFreeOnEnable: (row) => assertPortFree({ ...row, enabled: true }, row.id),
		cleanData: (_access, _createCertificate, data) => data,
		applyListOrder: (query) => query.orderBy("incoming_port", "ASC"),
		applySearch: (query, searchQuery) =>
			query.where(function () {
				this.where(castJsonIfNeed("incoming_port"), "like", `%${searchQuery}%`)
					.orWhere(castJsonIfNeed("forwarding_port"), "like", `%${searchQuery}%`)
					.orWhere("forwarding_host", "like", `%${searchQuery}%`)
					.orWhere("npmpro_description", "like", `%${searchQuery}%`);
			}),
	},
});

export default internalStream;
