// Inlined into every landing page by build.js (identical in all eight, so one CSP hash allows it): shows the texts of
// the visitor's browser language (English is in the HTML already), fills the time chip when nginx did not, and holds
// the captcha form's callback.
(() => {
	const texts = JSON.parse(document.getElementById("npmpro-texts").textContent);
	const wanted = [...(navigator.languages ?? []), navigator.language ?? ""];
	let code = "en";
	for (const tag of wanted) {
		const lower = String(tag).toLowerCase();
		const base = lower.split("-")[0];
		if (Object.hasOwn(texts, lower) || Object.hasOwn(texts, base)) {
			code = Object.hasOwn(texts, lower) ? lower : base;
			break;
		}
	}
	document.documentElement.lang = code;
	for (const element of document.querySelectorAll("[data-t]")) {
		const text = texts[code][element.dataset.t];
		if (text) element.textContent = text;
	}
	const time = document.querySelector("[data-npmpro-time]");
	if (time && time.textContent.trim() === "") {
		time.textContent = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
	}
	window.captchaCallback = () => {
		setTimeout(() => document.getElementById("captcha-form")?.submit(), 500);
	};
})();
