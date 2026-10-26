"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" aria-current={path === "/" ? "page" : undefined}>
        Agent
      </Link>
      <Link href="/how-it-works" aria-current={path === "/how-it-works" ? "page" : undefined}>
        How it works
      </Link>
    </nav>
  );
}
