import React from "react";
import type { AppModule } from "../navigation/registry";
import { LoginRequired } from "../navigation/LoginRequired";
import { NAV_ICONS } from "../navigation/icons";
import { PresencePanel } from "./PresencePanel";

/** Modul „Spielt gerade“: eigener Menüpunkt, sichtbar sobald im Adminbereich eingeschaltet. */
export const presenceModule: AppModule = {
  id: "presence",
  pages: [
    {
      id: "presence",
      hash: "playing",
      order: 25,
      label: (t) => t("main.nav.presence"),
      icon: NAV_ICONS.presence,
      enabled: (ctx) => ctx.settings.featuresGamePresenceEnabled,
      inMenu: (ctx) => Boolean(ctx.currentUser),
      hero: (t) => ({
        eyebrow: t("main.route.presence.eyebrow"),
        title: t("main.route.presence.title"),
        description: ""
      }),
      render: (ctx) => (ctx.currentUser ? <PresencePanel /> : <LoginRequired eyebrowKey="main.nav.presence" />)
    }
  ]
};
