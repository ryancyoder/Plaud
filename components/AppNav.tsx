"use client";

import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/board", label: "Board" },
  { href: "/actions", label: "Actions" },
  { href: "/map", label: "Map" },
  { href: "/calendar", label: "Calendar" },
];

interface AppNavProps {
  current: string; // href of current page
}

export default function AppNav({ current }: AppNavProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Link href="/" className="flex items-center gap-2 mr-1.5">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <span className="text-base font-bold tracking-tight">Plaud</span>
      </Link>
      {NAV_LINKS.map((link) => {
        const isActive = link.href === current;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium active:scale-95 ${
              isActive
                ? "bg-accent/10 text-accent border border-accent/30"
                : "text-muted border border-border hover:bg-gray-50"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
