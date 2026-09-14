export default function PageHeading({ title }: { title: string }) {
  return <div className="rf-page-heading">
    <span className="rf-page-heading-mark" aria-hidden="true">AA</span>
    <div><span className="rf-page-heading-brand">Authority Activation</span><h1>{title}</h1></div>
  </div>;
}
