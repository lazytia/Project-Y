import Link from "next/link";
import type { ServerSession } from "@/lib/dashboard-session";
import { navForSessionRole, type NavGroup } from "@/lib/sidebar-nav";
import shellStyles from "./AppShell.module.css";
import sidebarStyles from "./Sidebar.module.css";

function ServerNavGroup({ group }: { group: NavGroup }) {
  if (group.href) {
    return (
      <div className={sidebarStyles.group}>
        <Link href={group.href} className={sidebarStyles.groupHeader}>
          <span className={sidebarStyles.icon}>{group.icon}</span>
          <span>{group.label}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className={sidebarStyles.group}>
      <div className={sidebarStyles.groupHeader}>
        <span className={sidebarStyles.icon}>{group.icon}</span>
        <span className={sidebarStyles.groupLabel}>{group.label}</span>
      </div>
      {group.children && (
        <div className={`${sidebarStyles.collapseWrap} ${sidebarStyles.collapseOpen}`}>
          <ul className={sidebarStyles.children}>
            {group.children.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={sidebarStyles.childLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * SSR app chrome when the uid session cookie is present. Paints sidebar +
 * mobile header in the first HTML response so PWA cold starts never sit on a
 * blank screen while Firebase Auth hydrates on the client.
 *
 * Sibling to AppShell — must NOT wrap page content. Hiding #server-app-shell
 * when the client shell mounts would otherwise hide the entire React tree.
 */
export default function ServerAppShell({ session }: { session: ServerSession }) {
  if (!session.authenticated) return null;

  const nav = navForSessionRole(session.role);

  return (
    <div id="server-app-shell" className={shellStyles.shell} aria-hidden="true">
      <div className={shellStyles.mobileHeader}>
        <div className={`${shellStyles.hamburger} ${shellStyles.serverChromePlaceholder}`}>
          <span className={shellStyles.bar} />
          <span className={shellStyles.bar} />
          <span className={shellStyles.bar} />
        </div>
        <span className={shellStyles.mobileBrand}>YURICA</span>
        <div className={`${shellStyles.bellBtn} ${shellStyles.serverChromePlaceholder}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
      </div>
      <aside className={`${sidebarStyles.sidebar} ${sidebarStyles.sidebarClosed}`}>
        <div className={sidebarStyles.brand}>YURICA</div>
        <nav className={sidebarStyles.nav}>
          {nav.map((group) => (
            <ServerNavGroup key={group.label} group={group} />
          ))}
        </nav>
      </aside>
    </div>
  );
}
