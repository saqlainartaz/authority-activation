"use client";

// The operator console's global navigation: Clients, and System health beside it
// (Cycle 5 P3.3). System health exists only on the rehaul engine; under M1 the
// entry is absent, not empty. `rehaul` comes from `GET /api/internal/engine`
// (P2.5); unknown or unreadable counts as M1.

import { Activity, ArrowRight, Users } from "lucide-react";

import { Button as DesignButton } from "@/components/ui/button";

export type ConsoleView = "clients" | "health";

export function GlobalNav({ view, creating, clientCount, rehaul, onClients, onHealth }: {
  view: ConsoleView; creating: boolean; clientCount: number; rehaul: boolean; onClients: () => void; onHealth: () => void;
}) {
  const health = rehaul && view === "health";
  return (
    <nav aria-label="Main">
      <button type="button" className="idc-nav" data-active={!creating && !health} onClick={onClients} aria-label="Clients"><Users /><span>Clients</span><small className="idc-nav-count">{clientCount}</small></button>
      {rehaul ? <button type="button" className="idc-nav" data-active={health} aria-current={health ? "page" : undefined} onClick={onHealth} aria-label="System health"><Activity /><span>System health</span></button> : null}
    </nav>
  );
}

/** The same destinations in the phone menu. */
export function MobileNavRows({ rehaul, onClients, onHealth }: { rehaul: boolean; onClients: () => void; onHealth: () => void }) {
  return (
    <div className="idc-rows">
      <div className="idc-row"><div className="idc-row-main"><strong>Clients</strong></div><DesignButton variant="outline" size="sm" onClick={onClients}>Open <ArrowRight size={14} /></DesignButton></div>
      {rehaul ? <div className="idc-row"><div className="idc-row-main"><strong>System health</strong></div><DesignButton variant="outline" size="sm" onClick={onHealth} aria-label="Open System health">Open <ArrowRight size={14} /></DesignButton></div> : null}
    </div>
  );
}
