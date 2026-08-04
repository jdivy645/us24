export default function Toasts({ toasts }) {
  return (
    <div id="toast">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.type}>{t.msg}</div>
      ))}
    </div>
  );
}
