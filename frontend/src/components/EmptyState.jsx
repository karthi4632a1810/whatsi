export default function EmptyState({ title, hint }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {hint}
    </div>
  );
}
