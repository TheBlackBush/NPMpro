import { useNavigate } from "react-router";
import { Button } from "src/components";
import { T } from "src/locale";

/**
 * The not-found message. page: it is the whole page (the router's unknown route), so its title is the page's h1; inside
 * a page that has its own (an unknown Settings section or Monitoring tab) the title stays a paragraph
 *
 * @param {Object}  props
 * @param {boolean} [props.page]
 */
export function ErrorNotFound({ page = false }) {
	const navigate = useNavigate();
	const Title = page ? "h1" : "p";

	return (
		<div className="container-tight py-4">
			<div className="empty">
				<div className="empty-header">404</div>
				<Title className="empty-title">
					<T id="notfound.title" />
				</Title>
				<p className="empty-subtitle text-secondary">
					<T id="notfound.content" />
				</p>
				<div className="empty-action">
					<Button type="button" color="primary" onClick={() => navigate("/")}>
						<T id="notfound.action" />
					</Button>
				</div>
			</div>
		</div>
	);
}
