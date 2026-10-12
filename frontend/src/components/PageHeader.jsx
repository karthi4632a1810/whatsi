/** A screen's title block, in the portal's section-header style. */
export default function PageHeader({ title, lead, children }) {
  return (
    <div className="section-header section-header-flex">
      <div>
        <h2>{title}</h2>
        {lead ? <p className="section-subtitle">{lead}</p> : null}
      </div>
      {children ? <div className="section-header-actions">{children}</div> : null}
    </div>
  );
}
