import errs from "../error.js";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;

/**
 * True when text is the plain decimal form of a positive safe integer: no sign, no fraction, no trailing text.
 *
 * @param   {*}  text
 * @returns {Boolean}
 */
const isPositiveInteger = (text) =>
	typeof text === "string" && POSITIVE_INTEGER.test(text) && Number.isSafeInteger(Number(text));

/**
 * Handler for `router.param(name, pathId)`: refuses a path id that is not a positive integer with a 400, before any
 * handler of the router reads it with parseInt (which would act on `1.5` or `1abc` as host 1, and on `0` or `abc`
 * as an id that does not exist).
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 * @param {String}   value  the raw path segment
 * @param {String}   name   the parameter name
 */
const pathId = (_req, _res, next, value, name) => {
	if (!isPositiveInteger(value)) {
		return next(new errs.ValidationError(`The ${name.replace(/_id$/u, "")} id must be a positive integer`));
	}
	next();
};

export { isPositiveInteger };
export default pathId;
