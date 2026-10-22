import express from "express";
import internalDnsCredential from "../../internal/dns-credential.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import apiValidator from "../../lib/validator/api.js";
import validator from "../../lib/validator/index.js";
import { getValidationSchema } from "../../schema/index.js";

const listSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		expand: { $ref: "common#/properties/expand", items: { enum: ["owner", "certificates"] } },
		query: { $ref: "common#/properties/query" },
	},
};

const credentialSchema = {
	type: "object",
	required: ["credential_id"],
	additionalProperties: false,
	properties: {
		credential_id: { $ref: "common#/properties/id" },
		expand: { $ref: "common#/properties/expand", items: { enum: ["owner", "certificates"] } },
	},
};

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

/**
 * /api/nginx/dns-credentials
 */
router
	.route("/")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(listSchema, {
			expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
			query: typeof req.query.query === "string" ? req.query.query : null,
		});
		res.status(200).send(await internalDnsCredential.getAll(res.locals.access, data.expand, data.query));
	})
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-credentials", "post"), req.body);
		res.status(201).send(await internalDnsCredential.create(res.locals.access, payload));
	});

/**
 * /api/nginx/dns-credentials/123
 */
router
	.route("/:credential_id")
	.all(jwtdecode())
	.get(async (req, res) => {
		const data = validator(credentialSchema, {
			credential_id: req.params.credential_id,
			expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
		});
		res.status(200).send(
			await internalDnsCredential.getPublic(res.locals.access, {
				id: Number.parseInt(data.credential_id, 10),
				expand: data.expand,
			}),
		);
	})
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-credentials/{credentialID}", "put"), req.body);
		payload.id = Number.parseInt(req.params.credential_id, 10);
		res.status(200).send(await internalDnsCredential.update(res.locals.access, payload));
	})
	.delete(async (req, res) => {
		res.status(200).send(
			await internalDnsCredential.delete(res.locals.access, {
				id: Number.parseInt(req.params.credential_id, 10),
			}),
		);
	});

export default router;
