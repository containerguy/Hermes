import React from "react";
import type { AppModule } from "../navigation/registry";
import { LoginRequired } from "../navigation/LoginRequired";
import { NAV_ICONS } from "../navigation/icons";
import { PizzaPanel } from "./PizzaPanel";
import { hasPermission } from "../permissions";

/** Modul Pizzabestellung: eigener Menüpunkt, sichtbar sobald im Adminbereich eingeschaltet. */
export const pizzaModule: AppModule = {
  id: "pizza",
  pages: [
    {
      id: "pizza",
      hash: "pizza",
      order: 30,
      label: (t) => t("main.nav.pizza"),
      icon: NAV_ICONS.pizza,
      enabled: (ctx) => ctx.settings.featuresPizzaEnabled,
      inMenu: (ctx) => Boolean(ctx.currentUser),
      hero: (t) => ({
        eyebrow: t("main.route.pizza.eyebrow"),
        title: t("main.route.pizza.title"),
        description: ""
      }),
      render: (ctx) =>
        ctx.currentUser ? (
          <PizzaPanel
            currentUserId={ctx.currentUser.id}
            currentUserRole={ctx.currentUser.role}
            canManagePizza={hasPermission(ctx.currentUser, "pizza.manage")}
            currentMainEventId={ctx.currentUser.currentMainEventId ?? null}
            paypalHandle={ctx.settings.pizzaPaypalHandle}
            paypalName={ctx.settings.pizzaPaypalName}
            cashRecipient={ctx.settings.pizzaCashRecipient}
          />
        ) : (
          <LoginRequired eyebrowKey="main.nav.pizza" />
        )
    }
  ]
};
