export default function BrandIcon({ size = 32 }: { size?: number }) {
  return (
    <img
      src="./icon.png"
      alt="FreeCut"
      width={size}
      height={size}
      draggable={false}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}
