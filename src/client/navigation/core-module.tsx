import React from "react";
import type { AdminSection } from "../types/core";
import { AdminPanel } from "../components/AdminPanel";
import { EventBoard } from "../components/EventBoard";
import { InfosPage } from "../components/InfosPage";
import { LoginPage } from "../components/LoginPage";
import { MainEventPrompt } from "../components/MainEventPrompt";
import { MainEventsPanel } from "../components/MainEventsPanel";
import { GameAccountsPrompt } from "../presence/GameAccountsPrompt";
import { type ProfileSectionId, profileSectionIds } from "../components/LoginPanel";
import { LoginRequired } from "./LoginRequired";
import { NAV_ICONS } from "./icons";
import type { AdminNavEntry, AppModule, NavContext, NavPageRenderContext } from "./registry";
import { hasPermission, hasPermissionAnywhere, isAdministrator } from "../permissions";

export const coreAdminSections: AdminSection[] = ["users", "betrieb", "design", "infos", "sicherheit", "invites", "audit"];

const coreAdminLabelKeys = {
  users: "main.admin.nav.users",
  betrieb: "main.admin.nav.ops",
  design: "main.admin.nav.design",
  infos: "main.admin.nav.infos",
  sicherheit: "main.admin.nav.security",
  invites: "main.admin.nav.invites",
  audit: "main.admin.nav.audit"
} as const;

const profileLabelKeys = {
  konto: "main.profile.nav.account",
  spielkonten: "main.profile.nav.gameAccounts",
  benachrichtigungen: "main.profile.nav.notifications",
  geraete: "main.profile.nav.devices",
  tokens: "main.profile.nav.tokens"
} as const;

function canOrganizeRounds(ctx: NavContext) {
  return (
    hasPermissionAnywhere(ctx.currentUser, "rounds.create") || hasPermissionAnywhere(ctx.currentUser, "rounds.manage")
  );
}

function canManageAnyMainEvent(ctx: NavContext) {
  return hasPermissionAnywhere(ctx.currentUser, "main_events.manage");
}

function firstSegment(subPath: string) {
  return subPath.split("/")[0] ?? "";
}

/**
 * Baut die Kernseiten. `moduleAdminSections` sind die Admin-Unterpunkte aller Module, damit der
 * Adminbereich sie im Untermenü zeigen und rendern kann.
 */
export function createCoreModule(moduleAdminSections: AdminNavEntry[]): AppModule {
  function enabledModuleAdmin(ctx: NavContext) {
    return moduleAdminSections.filter((entry) => (entry.enabled ? entry.enabled(ctx) : true));
  }

  return {
    id: "core",
    pages: [
      {
        id: "events",
        hash: "events",
        aliases: ["", "manager", "runden"],
        order: 10,
        label: (t) => t("main.nav.rounds"),
        icon: NAV_ICONS.rounds,
        inMenu: () => true,
        hero: (t, ctx) => {
          const customDescription = ctx.settings.shellStartDescription.trim();
          return {
            eyebrow: t("main.route.events.eyebrow"),
            title: ctx.settings.shellStartTitle.trim() || t("main.route.events.title"),
            description: customDescription
          };
        },
        render: (ctx) => (
          <>
            {ctx.currentUser ? <MainEventPrompt currentUserId={ctx.currentUser.id} /> : null}
            {ctx.currentUser && ctx.settings.featuresGamePresenceEnabled ? (
              <GameAccountsPrompt currentUserId={ctx.currentUser.id} />
            ) : null}
            <EventBoard
              currentUser={ctx.currentUser}
              mode={canOrganizeRounds(ctx) ? "manager" : "events"}
              emptyBoardTitle={ctx.settings.shellEventsEmptyTitle}
              emptyBoardBody={ctx.settings.shellEventsEmptyBody}
              gameCatalog={ctx.settings.gameCatalog}
              ampIntegrationEnabled={ctx.settings.ampIntegrationEnabled}
            />
          </>
        )
      },
      {
        id: "main-events",
        hash: "main-events",
        order: 20,
        label: (t) => t("main.nav.mainEvents"),
        icon: NAV_ICONS.mainEvents,
        inMenu: (ctx) => Boolean(ctx.currentUser),
        hero: (t, ctx) => ({
          eyebrow: t("main.route.mainEvents.eyebrow"),
          title: t("main.route.mainEvents.title"),
          description: canManageAnyMainEvent(ctx) ? t("main.route.mainEvents.descriptionManager") : ""
        }),
        render: (ctx) =>
          ctx.currentUser ? (
            <MainEventsPanel
              canManage={hasPermission(ctx.currentUser, "main_events.manage")}
              canManageEvent={(mainEventId) => hasPermission(ctx.currentUser, "main_events.manage", mainEventId)}
            />
          ) : (
            <LoginRequired eyebrowKey="main.nav.mainEvents" />
          )
      },
      {
        id: "infos",
        hash: "infos",
        order: 80,
        label: (t) => t("main.nav.infos"),
        icon: NAV_ICONS.infos,
        inMenu: (ctx) => Boolean(ctx.currentUser) && ctx.settings.infosEnabled,
        hero: (t) => ({
          eyebrow: t("main.route.infos.eyebrow"),
          title: t("main.route.infos.title"),
          description: ""
        }),
        render: (ctx) =>
          ctx.currentUser ? (
            <InfosPage
              markdown={ctx.settings.infosMarkdown}
              enabled={ctx.settings.infosEnabled}
              currentMainEventId={ctx.currentUser.currentMainEventId ?? null}
            />
          ) : (
            <LoginRequired eyebrowKey="main.route.infos.eyebrow" />
          )
      },
      {
        id: "admin",
        hash: "admin",
        order: 90,
        label: (t) => t("main.nav.admin"),
        icon: NAV_ICONS.admin,
        inMenu: (ctx) => isAdministrator(ctx.currentUser),
        hero: (t) => ({
          eyebrow: t("main.route.admin.eyebrow"),
          title: t("main.route.admin.title"),
          description: t("main.route.admin.description")
        }),
        subnavLabel: (t) => t("main.admin.subnav"),
        subnav: (t, ctx) =>
          isAdministrator(ctx.currentUser)
            ? [
                ...coreAdminSections.map((slug) => ({ slug, label: t(coreAdminLabelKeys[slug]) })),
                ...enabledModuleAdmin(ctx).map((entry) => ({ slug: entry.slug, label: entry.label(t) }))
              ]
            : [],
        render: (ctx: NavPageRenderContext) => {
          const slug = firstSegment(ctx.subPath);
          const moduleSection =
            isAdministrator(ctx.currentUser) ? enabledModuleAdmin(ctx).find((entry) => entry.slug === slug) : undefined;
          if (moduleSection) {
            return <section className="admin-stage">{moduleSection.render(ctx)}</section>;
          }
          const section = (coreAdminSections as string[]).includes(slug) ? (slug as AdminSection) : "users";
          return (
            <section className="admin-stage">
              <AdminPanel currentUser={ctx.currentUser} adminSection={section} onSettingsChanged={ctx.applySettings} />
            </section>
          );
        }
      },
      {
        id: "login",
        hash: "login",
        order: 100,
        label: (t) => t("main.nav.login"),
        icon: NAV_ICONS.profile,
        // Profil und Login erreicht man über den Avatar oben rechts.
        inMenu: () => false,
        hero: (t, ctx) =>
          ctx.currentUser
            ? {
                eyebrow: t("main.route.profileLogin.eyebrow"),
                title: t("main.route.profileLogin.title"),
                description: ""
              }
            : {
                eyebrow: t("main.route.login.eyebrow"),
                title: t("main.route.login.title"),
                description: t("main.route.login.description")
              },
        subnavLabel: (t) => t("main.profile.subnav"),
        subnav: (t, ctx) =>
          ctx.currentUser
            ? profileSectionIds
                .filter((slug) => slug !== "spielkonten" || ctx.settings.featuresGamePresenceEnabled)
                .map((slug) => ({ slug, label: t(profileLabelKeys[slug]) }))
            : [],
        render: (ctx) => {
          const slug = firstSegment(ctx.subPath);
          const available = slug !== "spielkonten" || ctx.settings.featuresGamePresenceEnabled;
          const section: ProfileSectionId = available && (profileSectionIds as readonly string[]).includes(slug)
            ? (slug as ProfileSectionId)
            : "konto";
          return (
            <LoginPage
              currentUser={ctx.currentUser}
              settings={ctx.settings}
              profileSection={section}
              onLoggedIn={ctx.setCurrentUser}
              onLoggedOut={() => ctx.setCurrentUser(null)}
              onUserUpdated={ctx.setCurrentUser}
            />
          );
        }
      }
    ]
  };
}
