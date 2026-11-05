import errs from "../error.js";
import { isPositiveInteger } from "./path-id.js";

export default (req, res, next) => {
	if (req.params.user_id === "me" && res.locals.access) {
		req.params.user_id = res.locals.access.token.getUserId(0);
		if (!req.params.user_id) {
			return next(new errs.PermissionError());
		}
		return next();
	}

	if (!isPositiveInteger(req.params.user_id)) {
		return next(new errs.ValidationError("The user id must be me or a positive integer"));
	}
	req.params.user_id = Number(req.params.user_id);
	next();
};
