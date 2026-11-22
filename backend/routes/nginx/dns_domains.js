import express from "express";
import internalDnsDomain from "../../internal/dns-domain.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import pathId from "../../lib/express/path-id.js";
import apiValidator from "../../lib/validator/api.js";
import validator from "../../lib/validator/index.js";
import { getValidationSchema } from "../../schema/index.js";

const EXPAND = { $ref: "common#/properties/expand", items: { enum: ["credential"] } };
const listSchema = {
	type: "object",
	additionalProperties: false,
	properties: { expand: EXPAND, query: { $ref: "common#/properties/query" } },
};
const oneSchema = {
	type: "object",
	required: ["domain_id"],
	additionalProperties: false,
	properties: { domain_id: { $ref: "common#/properties/id" }, expand: EXPAND },
};
const expandOf = (req) => (typeof req.query.expand === "string" ? req.query.expand.split(",") : null);

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

router.param("domain_id", pathId);

/**
 * /api/nginx/dns-domains
 */
router
	.route("/")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(listSchema, {
			expand: expandOf(req),
			query: typeof req.query.query === "string" ? req.query.query : null,
		});
		res.status(200).send(await internalDnsDomain.getAll(res.locals.access, data));
	})
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-domains", "post"), req.body);
		res.status(201).send(await internalDnsDomain.create(res.locals.access, payload));
	});

/**
 * /api/nginx/dns-domains/123
 */
router
	.route("/:domain_id")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(oneSchema, { domain_id: req.params.domain_id, expand: expandOf(req) });
		res.status(200).send(
			await internalDnsDomain.get(res.locals.access, {
				id: Number.parseInt(data.domain_id, 10),
				expand: data.expand,
			}),
		);
	})
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-domains/{domainID}", "put"), req.body);
		res.status(200).send(
			await internalDnsDomain.move(res.locals.access, {
				id: Number.parseInt(req.params.domain_id, 10),
				dns_credential_id: payload.dns_credential_id,
			}),
		);
	})
	.delete(async (req, res) => {
		res.status(200).send(
			await internalDnsDomain.delete(res.locals.access, { id: Number.parseInt(req.params.domain_id, 10) }),
		);
	});

export default router;
