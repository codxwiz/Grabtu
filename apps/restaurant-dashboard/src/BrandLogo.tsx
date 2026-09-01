const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME || "Grabtu";

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`grabtu-logo ${className}`.trim()} role="img" aria-label={PRODUCT_NAME}>
      <img className="grabtu-logo-light" src="/grabtu-logo-light.png" alt="" decoding="async" />
      <img className="grabtu-logo-dark" src="/grabtu-logo-dark.png" alt="" decoding="async" />
    </span>
  );
}
