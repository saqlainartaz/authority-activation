// `/internal` uses its own operator shell while sharing the product's type,
// spacing, surfaces, and interaction language. It must feel related without
// ever being mistaken for a client's content workspace.
export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return <main className="internal-admin min-h-screen bg-surface-3 text-ink selection:bg-accent/25">{children}</main>;
}
import "./admin.css";
