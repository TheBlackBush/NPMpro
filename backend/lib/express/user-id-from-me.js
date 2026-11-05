import errs from "../error.js";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;

export default (req, res, next) => {
	if (req.params.user_id === "me" && res.locals.access) {
		req.params.user_id = res.locals.access.token.getUserId(0);
		if (!req.params.user_id) {
			return next(new errs.PermissionError());
		}
		return next();
	}

	const id = Number(req.params.user_id);
	if (!(POSITIVE_INTEGER.test(req.params.user_id) && Number.isSafeInteger(id))) {
		return next(new errs.ValidationError("The user id must be me or a positive integer"));
	}
	req.params.user_id = id;
	next();
};
