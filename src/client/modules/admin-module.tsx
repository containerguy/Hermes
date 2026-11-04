import React from "react";
import type { AppModule } from "../navigation/registry";
import { AdminModules } from "./AdminModules";

/** Admin › Module: Verwaltung der Laufzeit-Module (Kernbestandteil, kein ladbares Modul). */
export const moduleManagerModule: AppModule = {
  id: "module-manager",
  adminSections: [
    {
      slug: "module",
      order: 75,
      label: (t) => t("main.admin.nav.modules"),
      render: (ctx) => (ctx.currentUser ? <AdminModules currentUser={ctx.currentUser} subPath={ctx.subPath} /> : null)
    }
  ]
};
