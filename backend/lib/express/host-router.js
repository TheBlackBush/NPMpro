import express from "express";
import { getValidationSchema } from "../../schema/index.js";
import apiValidator from "../validator/api.js";
import validator from "../validator/index.js";
import jwtdecode from "./jwt-decode.js";
import pathId from "./path-id.js";

/**
 * The routes of a host type
 *
 * @param   {Object}    options
 * @param   {Object}    options.internal    the host service
 * @param   {String}    options.path        the path in the OpenAPI schema, /nginx/dead-hosts
 * @param   {String[]}  options.expandEnum  what ?expand may ask for
 * @param   {String}    options.idParam     host_id or stream_id
 * @returns {express.Router}
 */
const hostRouter = ({ internal, path, expandEnum, idParam }) => {
	const itemPath = `${path}/{${idParam.replace(/_id$/u, "ID")}}`;

	const listSchema = {
		type: "object",
		additionalProperties: false,
		properties: {
			expand: {
				$ref: "common#/properties/expand",
				items: { enum: expandEnum },
			},
			query: {
				$ref: "common#/properties/query",
			},
		},
	};

	const itemSchema = {
		type: "object",
		required: [idParam],
		additionalProperties: false,
		properties: {
			[idParam]: {
				$ref: "common#/properties/id",
			},
		},
	};

	const idOf = (req) => Number.parseInt(req.params[idParam], 10);

	const router = express.Router({
		caseSensitive: true,
		strict: true,
		mergeParams: true,
	});

	router.param(idParam, pathId);

	router
		.route("/")
		.all(jwtdecode())
		.get(async (req, res) => {
			const data = validator(listSchema, {
				expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
				query: typeof req.query.query === "string" ? req.query.query : null,
			});
			const rows = await internal.getAll(res.locals.access, data.expand, data.query);
			res.status(200).send(rows);
		})
		.post(async (req, res) => {
			const payload = apiValidator(getValidationSchema(path, "post"), req.body);
			const result = await internal.create(res.locals.access, payload);
			res.status(201).send(result);
		});

	router
		.route(`/:${idParam}`)
		.all(jwtdecode())
		.get(async (req, res) => {
			const data = validator(itemSchema, {
				[idParam]: req.params[idParam],
			});
			const row = await internal.get(res.locals.access, {
				id: Number.parseInt(data[idParam], 10),
			});
			res.status(200).send(row);
		})
		.put(async (req, res) => {
			const payload = apiValidator(getValidationSchema(itemPath, "put"), req.body);
			payload.id = idOf(req);
			const result = await internal.update(res.locals.access, payload);
			res.status(200).send(result);
		})
		.delete(async (req, res) => {
			const result = await internal.delete(res.locals.access, { id: idOf(req) });
			res.status(200).send(result);
		});

	router
		.route(`/:${idParam}/enable`)
		.all(jwtdecode())
		.post(async (req, res) => {
			const result = await internal.enable(res.locals.access, { id: idOf(req) });
			res.status(200).send(result);
		});

	router
		.route(`/:${idParam}/disable`)
		.all(jwtdecode())
		.post(async (req, res) => {
			const result = await internal.disable(res.locals.access, { id: idOf(req) });
			res.status(200).send(result);
		});

	return router;
};

export default hostRouter;
