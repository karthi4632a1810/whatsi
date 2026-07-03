export default function PageHeader({ eyebrow, title, lead }) {
  return (
    <header className="page-header">
      {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
      <h2 className="page-title">{title}</h2>
      {lead ? <p className="page-lead">{lead}</p> : null}
    </header>
  );
}
