import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid-lines grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <p className="font-display text-[160px] leading-none">404</p>
        <p className="mb-6 text-lg text-steel">That page isn&apos;t on the press.</p>
        <Link href="/" className="inline-flex h-12 items-center border-[1.5px] border-ink bg-signal px-6 font-bold">
          Back to the shop floor
        </Link>
      </div>
    </div>
  );
}
