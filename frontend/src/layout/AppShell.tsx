import { ReactNode, useState } from "react";
import { TopBar } from "./TopBar";
import { SideNav } from "./SideNav";

type Props = { children: ReactNode };

export function AppShell({ children }: Props) {
  const [search, setSearch] = useState("");
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--surface-0)" }}>
      <TopBar search={search} onSearch={setSearch} />
      <div style={{ display: "flex", flex: 1, alignItems: "stretch" }}>
        <SideNav />
        <main
          style={{
            flex: 1,
            padding: "20px 40px 40px",
            maxWidth: "var(--layout-max)",
            margin: "0 auto",
            width: "100%",
            position: "relative",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
