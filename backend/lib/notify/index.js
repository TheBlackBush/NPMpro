import { buildData, clean, eventById, makeEnvelope, messageId } from "./catalogue.js";

// createNotify: the one entry of the event layer. Sources call emit() for an action, reportState() for a state that
// changes, clearState() and clearMatching() when the object goes away. Nothing here throws into the source: a failure
// is logged (warn) and the call resolves undefined, so a failed delivery never fails its cause. Log lines hold the
// event and the object only, never data.

const objectOf = (source) => source?.id ?? source?.record?.id ?? source?.schedule?.id ?? "-";

/**
 * @param   {Object}    options
 * @param   {Object}    [options.catalogue]   { buildData, eventById } (the real one by default)
 * @param   {Object}    options.stateStore
 * @param   {Object}    options.queue
 * @param   {Object}    options.worker
 * @param   {Object}    [options.log]
 * @param   {Object}    [options.clock]       { now() } in ms
 * @param   {Function}  [options.randomId]    () => message id
 */
const createNotify = ({
	catalogue = { buildData, eventById },
	stateStore,
	queue,
	worker,
	log,
	clock = { now: () => Date.now() },
	randomId = messageId,
}) => {
	const registered = [];

	const fail = (what, error) => {
		log?.warn?.(`notify: ${what} failed: ${clean(error?.message ?? String(error))}`);
	};

	// one channel: does it want the event, which rows; an error only skips this channel
	const rowsFor = async (channel, type, envelope, payload) => {
		try {
			if (!(await channel.accepts(type))) return [];
			const targets = await channel.targets(envelope);
			return targets.map((target) => ({
				message_id: envelope.id,
				event: type,
				channel: channel.id,
				target_id: target.target_id ?? null,
				recipient: target.recipient ?? null,
				group_key: target.group_key ?? null,
				delay_ms: target.delay_ms ?? 0,
				payload,
			}));
		} catch (error) {
			fail(`${channel.id} for ${type}`, error);
			return [];
		}
	};

	// the data of an event goes to every channel that wants it
	const deliver = async (type, data, object) => {
		try {
			log?.debug?.(`notify: ${type} ${object}`);
			if (!catalogue.eventById(type)) throw new Error(`${type} is not a notification event`);
			const envelope = makeEnvelope(type, data, { now: new Date(clock.now()), randomId });
			const payload = JSON.stringify(envelope);
			const rows = [];
			for (const channel of [...registered]) rows.push(...(await rowsFor(channel, type, envelope, payload)));
			if (rows.length === 0) return;
			await queue.add(rows);
			worker.kick();
		} catch (error) {
			fail(type, error);
		}
	};

	return {
		/** Sends an action event (or any event with its data built from the source) */
		emit: async (type, source) => {
			try {
				await deliver(type, catalogue.buildData(type, source), objectOf(source));
			} catch (error) {
				fail(type, error);
			}
		},

		/** Sends data already built (the reminders of the sweep) */
		deliver: (type, data, object = "-") => deliver(type, data, object),

		/** Stores the state of an object; the change, when there is one, goes out as the event or its .resolved twin. Answers whether the state was stored */
		reportState: async (event, objectId, { state, source = {} } = {}) => {
			try {
				const data = catalogue.buildData(event, { ...source, state });
				const change = await stateStore.report({ event, objectId, state, data });
				if (change) await deliver(change.type, change.data, objectId);
				return true;
			} catch (error) {
				fail(event, error);
				return false;
			}
		},

		/** Removes the state of a deleted object, no event. Answers whether it was removed */
		clearState: async (event, objectId) => {
			try {
				await stateStore.clear(event, objectId);
				return true;
			} catch (error) {
				fail(`${event} clear`, error);
				return false;
			}
		},

		/** Removes the states of an object and its parts (proxy_host:12 and proxy_host:12:x), no event */
		clearMatching: async (event, prefix) => {
			try {
				await stateStore.clearMatching(event, prefix);
			} catch (error) {
				fail(`${event} clear`, error);
			}
		},

		/** Adds a channel; one with the same id replaces the old one */
		registerChannel: (channel) => {
			const at = registered.findIndex((one) => one.id === channel.id);
			if (at === -1) registered.push(channel);
			else registered[at] = channel;
		},

		channels: () => [...registered],
	};
};

export { createNotify };
