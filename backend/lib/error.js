const errs = {
	PermissionError: class extends Error {
		name = this.constructor.name;
		public = true;
		status = 403;

		constructor(message, messageI18n, options) {
			super(message || "Permission Denied", options);
			this.message_i18n = messageI18n;
		}
	},

	// a database move or its target test; details carries the driver message, shown as the error output
	DatabaseMoveError: class extends Error {
		name = this.constructor.name;
		public = true;

		constructor(code, message, { status = 400, details = null, cause } = {}) {
			super(message, cause ? { cause } : undefined);
			this.code = code;
			this.status = status;
			this.details = details;
			this.message_i18n = `database.error.${code}`;
		}
	},

	ItemNotFoundError: class extends Error {
		name = this.constructor.name;
		public = true;
		status = 404;

		constructor(id, options) {
			super(id ? `Not Found - ${id}` : "Not Found", options);
		}
	},

	AuthError: class extends Error {
		name = this.constructor.name;
		public = true;
		status = 401;

		constructor(message, messageI18n, options) {
			super(message, options);
			this.message_i18n = messageI18n;
		}
	},

	InternalValidationError: class extends Error {
		name = this.constructor.name;
		public = false;
		status = 400;
	},

	ConfigurationError: class extends Error {
		name = this.constructor.name;
		public = true;
		status = 400;
	},

	ValidationError: class extends Error {
		name = this.constructor.name;
		public = true;
		status = 400;

		constructor(message, messageI18n, options) {
			super(message, options);
			this.message_i18n = messageI18n;
		}
	},

	AssertionFailedError: class extends Error {
		name = this.constructor.name;
		public = false;
		status = 400;
	},

	CommandError: class extends Error {
		name = this.constructor.name;
		public = false;
	},
};

export default errs;
