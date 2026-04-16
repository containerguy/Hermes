import React from "react";
import type { User } from "../types/core";
import { EventBoard } from "./EventBoard";

export function ManagerPage({ currentUser }: { currentUser: User | null }) {
  return (
    <section className="manager-layout" aria-label="Manager Arbeitsbereich">
      <EventBoard currentUser={currentUser} mode="manager" />
    </section>
  );
}

