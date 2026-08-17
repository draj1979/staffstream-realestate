import type { ReactNode } from "react";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import Logo from "../_components/Logo";
import DashboardNav from "./_components/DashboardNav";
import LogoutButton from "./_components/LogoutButton";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const user = session.userId
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } })
    : null;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5">
        <div className="px-2">
          <Logo />
        </div>

        <nav className="mt-8 flex-1">
          <DashboardNav />
        </nav>

        <div className="border-t border-slate-200 pt-4">
          {user && <p className="mb-2 truncate px-1 text-xs text-slate-500">{user.email}</p>}
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto px-8 py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
