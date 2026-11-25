import express from "express";
import { updateNow } from "../../internal/ddns.js";
import internalDdnsRecord from "../../internal/ddns-record.js";
import internalHostDnsRecord from "../../internal/host-dns-record.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import pathId from "../../lib/express/path-id.js";
import apiValidator from "../../lib/validator/api.js";
import validator from "../../lib/validator/index.js";
import { getValidationSchema } from "../../schema/index.js";

const EXPAND = { $ref: "common#/properties/expand", items: { enum: ["credential", "owner"] } };
const listSchema = {
	type: "object",
	additionalProperties: false,
	properties: { expand: EXPAND, query: { $ref: "common#/properties/query" } },
};
const oneSchema = {
	type: "object",
	required: ["record_id"],
	additionalProperties: false,
	properties: { record_id: { $ref: "common#/properties/id" }, expand: EXPAND },
};
const expandOf = (req) => (typeof req.query.expand === "string" ? req.query.expand.split(",") : null);
const idOf = (req) => Number.parseInt(req.params.record_id, 10);

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

router.param("record_id", pathId);

/**
 * /api/nginx/ddns-records
 */
router
	.route("/")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(listSchema, {
			expand: expandOf(req),
			query: typeof req.query.query === "string" ? req.query.query : null,
		});
		res.status(200).send(await internalDdnsRecord.getAll(res.locals.access, data));
	})
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/ddns-records", "post"), req.body);
		res.status(201).send(await internalDdnsRecord.create(res.locals.access, payload));
	});

/**
 * /api/nginx/ddns-records/123
 */
router
	.route("/:record_id")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(oneSchema, { record_id: req.params.record_id, expand: expandOf(req) });
		res.status(200).send(
			await internalDdnsRecord.get(res.locals.access, {
				id: Number.parseInt(data.record_id, 10),
				expand: data.expand,
			}),
		);
	})
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/ddns-records/{recordID}", "put"), req.body);
		res.status(200).send(await internalDdnsRecord.update(res.locals.access, { ...payload, id: idOf(req) }));
	})
	.delete(async (req, res) => {
		res.status(200).send(await internalDdnsRecord.delete(res.locals.access, { id: idOf(req) }));
	});

/**
 * /api/nginx/ddns-records/123/update
 */
router
	.route("/:record_id/update")
	.all(jwtdecode())
	.post(async (req, res) => {
		res.status(200).send(await updateNow(res.locals.access, idOf(req)));
	});

/**
 * /api/nginx/ddns-records/123/adopt, leave and remove-at-provider: the host record option's choices
 */
for (const [segment, method] of [
	["adopt", "adopt"],
	["leave", "leave"],
	["remove-at-provider", "removeAtProvider"],
]) {
	router
		.route(`/:record_id/${segment}`)
		.all(jwtdecode())
		.post(async (req, res) => {
			res.status(200).send(await internalHostDnsRecord[method](res.locals.access, { id: idOf(req) }));
		});
}

/**
 * /api/nginx/ddns-records/123/history
 */
router
	.route("/:record_id/history")
	.all(jwtdecode())
	.get(async (req, res) => {
		res.status(200).send(await internalDdnsRecord.history(res.locals.access, { id: idOf(req) }));
	});

export default router;
