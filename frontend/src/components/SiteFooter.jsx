import { version as tablerVersion } from "@tabler/core/package.json";
import { IconBrandGithub } from "@tabler/icons-react";
import { useCheckVersion } from "src/hooks";
import { T } from "src/locale";

const repoUrl = "https://github.com/TheBlackBush/NPMpro";
// release builds are "<MAJOR.MINOR.PATCH>-<commit>", beta and develop builds end with "-<commit>"
const releaseBuildPattern = /^(?<release>\d+\.\d+\.\d+)-[0-9a-f]+$/u;
const commitPattern = /-(?<commit>[0-9a-f]+)$/u;

export function SiteFooter() {
	const { data: versionData } = useCheckVersion();

	const version = versionData?.current || "";
	const release = releaseBuildPattern.exec(version)?.groups.release;
	const commit = commitPattern.exec(version)?.groups.commit;
	const versionUrl = release ? `${repoUrl}/releases/tag/v${release}` : commit ? `${repoUrl}/tree/${commit}` : repoUrl;

	return (
		<footer className="footer d-print-none py-3">
			<div className="container-xl">
				<div className="row text-center align-items-center flex-row-reverse">
					<div className="col-lg-auto ms-lg-auto">
						<ul className="list-inline list-inline-dots mb-0">
							<li className="list-inline-item">
								<a href={repoUrl} target="_blank" className="link-secondary" rel="noopener">
									<T id="footer.github" />
									<IconBrandGithub className="icon icon-inline me-1" />
								</a>
							</li>
						</ul>
					</div>
					<div className="col-12 col-lg-auto mt-3 mt-lg-0">
						<ul className="list-inline list-inline-dots mb-0">
							<li className="list-inline-item">© {new Date().getFullYear()} AGPL-3.0 (and MIT)</li>
							<li className="list-inline-item">
								<a
									href="https://github.com/TheBlackBush"
									rel="noreferrer"
									target="_blank"
									className="link-secondary"
								>
									NPMpro by TheBlackBush
								</a>
							</li>
							<li className="list-inline-item">
								<a
									href="https://github.com/ZoeyVid/NPMplus"
									rel="noreferrer"
									target="_blank"
									className="link-secondary"
								>
									NPMplus by ZoeyVid
								</a>
							</li>
							<li className="list-inline-item">
								<a href="https://jc21.com" rel="noreferrer" target="_blank" className="link-secondary">
									jc21.com
								</a>
							</li>
							<li className="list-inline-item">
								Theme by{" "}
								<a href="https://tabler.io" rel="noreferrer" target="_blank" className="link-secondary">
									Tabler {tablerVersion}
								</a>
							</li>
							<li className="list-inline-item">
								<a href={versionUrl} className="link-secondary" target="_blank" rel="noopener">
									{" "}
									{version}{" "}
								</a>
							</li>
							{versionData?.updateAvailable && (
								<li className="list-inline-item">
									<a
										href={`${repoUrl}/releases/tag/${versionData.latest}`}
										className="link-warning fw-bold"
										target="_blank"
										rel="noopener"
										title={`New version ${versionData.latest} is available`}
									>
										<T id="update-available" data={{ latestVersion: versionData.latest }} />
									</a>
								</li>
							)}
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
}
