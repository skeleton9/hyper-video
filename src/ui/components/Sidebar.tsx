import type { ProjectRecord, ProjectStatus } from '../lib/api.ts';
import { formatTime, statusLabel } from '../lib/format.ts';

export function Sidebar({
	projects,
	selectedId,
	busy,
	onSelect,
	onCreate,
	onDelete,
}: {
	projects: ProjectRecord[];
	selectedId: string | undefined;
	busy: boolean;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onDelete: (id: string) => Promise<void>;
}) {
	return (
		<aside className="sidebar">
			<div className="brand">
				<span className="brand-mark">HV</span>
				<div>
					<strong>Hyper Video</strong>
					<p>短视频成片</p>
				</div>
			</div>
			<button className="new-project" disabled={busy} onClick={onCreate} type="button">
				新建项目
			</button>
			<nav className="project-list" aria-label="项目列表">
				{projects.length === 0 ? (
					<p className="empty-note">还没有项目。新建一个，丢个话题过来就能做短视频。</p>
				) : (
					projects.map((project) => {
						const active = project.id === selectedId;
						return (
							<div className={active ? 'project-row active' : 'project-row'} key={project.id}>
								<button
									className="project-item"
									onClick={() => onSelect(project.id)}
									type="button"
								>
									<span className="project-title">{project.title}</span>
									<span className="project-meta">
										<StatusDot status={project.status} />
										{statusLabel(project.status)}
										<span>·</span>
										{formatTime(project.updatedAt)}
									</span>
								</button>
								<button
									aria-label={`删除 ${project.title}`}
									className="project-delete"
									onClick={(event) => {
										event.stopPropagation();
										void onDelete(project.id);
									}}
									title="删除项目"
									type="button"
								>
									×
								</button>
							</div>
						);
					})
				)}
			</nav>
		</aside>
	);
}

function StatusDot({ status }: { status: ProjectStatus }) {
	return <span aria-hidden className={`dot dot-${status}`} />;
}
