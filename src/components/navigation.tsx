import {
  Boxes,
  ChevronDown,
} from "lucide-react";
import { navSections, pinnedResourcesNavId, type NavItem } from "../theme/resourceTheme";

export { navSections, overviewCards } from "../theme/resourceTheme";

export function Sidebar({
  activeId,
  clusterName,
  counts,
  pinnedCount,
  showWindowControlFallback,
  onSelect,
}: {
  activeId: string;
  clusterName: string;
  counts: Map<string, number>;
  pinnedCount: number;
  showWindowControlFallback: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        {showWindowControlFallback ? (
          <div className="window-control-fallback" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div className="brand-mark">
          <Boxes size={18} />
        </div>
        <div>
          <strong>Kite</strong>
          <span>native k8s cockpit</span>
        </div>
      </div>

      <nav className="nav-groups" aria-label="Resource navigation">
        {navSections.map((section) => (
          <section className="nav-section" key={section.title}>
            <header>
              <span>{section.title}</span>
              {section.title !== "Pinned" ? <ChevronDown size={14} /> : null}
            </header>
            {section.items.map((item) => (
              <NavButton
                active={item.id === activeId}
                count={item.id === pinnedResourcesNavId ? pinnedCount : item.kind ? counts.get(item.kind) ?? 0 : undefined}
                item={item}
                key={item.id}
                onSelect={onSelect}
              />
            ))}
          </section>
        ))}
      </nav>

      <div className="cluster-switcher">
        <span>Context</span>
        <strong>{clusterName}</strong>
      </div>
    </aside>
  );
}

function NavButton({
  active,
  count,
  item,
  onSelect,
}: {
  active: boolean;
  count?: number;
  item: NavItem;
  onSelect: (id: string) => void;
}) {
  const Icon = item.icon;
  return (
    <button className={active ? "nav-item active" : "nav-item"} type="button" onClick={() => onSelect(item.id)}>
      <Icon size={15} />
      <span>{item.label}</span>
      {count !== undefined ? <small>{count}</small> : null}
    </button>
  );
}
