export default function PageHeading({ title }: { title: string }) {
  return <div className="rf-page-heading">
    <span className="rf-page-heading-mark" aria-hidden="true">PP</span>
    <div><span className="rf-page-heading-brand">Promo Partner</span><h1>{title}</h1></div>
  </div>;
}
