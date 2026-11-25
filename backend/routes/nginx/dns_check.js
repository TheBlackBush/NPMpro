import express from "express";
import internalDnsCheck from "../../internal/dns-check.js";
import internalHostDnsRecord from "../../internal/host-dns-record.js";
import errs from "../../lib/error.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import apiValidator from "../../lib/validator/api.js";
import { getValidationSchema } from "../../schema/index.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

/**
 * /api/nginx/dns-check/hosts
 */
router
	.route("/hosts")
	.all(jwtdecode())
	.get(async (_req, res) => {
		res.status(200).send(await internalDnsCheck.hosts(res.locals.access));
	})
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-check/hosts", "post"), req.body);
		res.status(200).send(await internalDnsCheck.check(res.locals.access, payload.hosts));
	});

/**
 * /api/nginx/dns-check/plan
 */
router
	.route("/plan")
	.all(jwtdecode())
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-check/plan", "post"), req.body);
		res.status(200).send(
			await internalHostDnsRecord.planHost(res.locals.access, {
				hostType: payload.host_type,
				hostId: payload.host_id,
				names: payload.names,
			}),
		);
	});

/**
 * /api/nginx/dns-check/reach
 */
router
	.route("/reach")
	.all(jwtdecode())
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-check/reach", "post"), req.body);
		const { access } = res.locals;
		let host = null;
		if (payload.host_id !== undefined) {
			host = await internalHostDnsRecord.hostFor(access, {
				hostType: payload.host_type,
				hostId: payload.host_id,
			});
			const wanted = payload.name.toLowerCase();
			if (!(host.domain_names ?? []).some((name) => String(name).toLowerCase() === wanted)) {
				throw new errs.ValidationError(
					`The name ${payload.name} is not one of the host's names`,
					"error.host-dns-name-not-host",
					{ values: { name: payload.name } },
				);
			}
		}
		res.status(200).send(
			await internalHostDnsRecord.reach(access, { hostType: payload.host_type, host, name: payload.name }),
		);
	});

export default router;
