export default function Logo({ height = 30 }: { height?: number }) {
  return (
    <>
      <img src="/logo-light.png" alt="Recalcatti" className="logo-img logo-img-light" style={{ height }} />
      <img src="/logo-dark.png" alt="Recalcatti" className="logo-img logo-img-dark" style={{ height }} />
    </>
  );
}
