import React from "react";
import type { AdminSection } from "../types/core";
import { AdminPanel } from "../components/AdminPanel";
import { EventBoard } from "../components/EventBoard";
import { InfosPage } from "../components/InfosPage";
import { LoginPage } from "../components/LoginPage";
import { MainEventPrompt } from "../components/MainEventPrompt";
import { MainEventsPanel } from "../components/MainEventsPanel";
import {
  ModuleMenuEntryPage,
  ModuleNotices,
  ModuleProfileSection,
  moduleMenuEntries,
  resolveModuleMenuEntry
} from "../modules/runtime";
import { type ProfileSectionId, profileSectionIds } from "../components/LoginPanel";
import { LoginRequired } from "./LoginRequired";
import { NAV_ICONS } from "./icons";
import type { AdminNavEntry, AdminNavGroup, AppModule, NavContext, NavPageRenderContext, SubnavEntry } from "./registry";
import { hasPermission, hasPermissionAnywhere, isAdministrator } from "../permissions";

export const coreAdminSections: AdminSection[] = [
  "users",
  "import",
  "betrieb",
  "texte",
  "design",
  "infos",
  "kiosk",
  "integrationen",
  "sicherheit",
  "backup",
  "invites",
  "audit"
];

const coreAdminLabelKeys = {
  users: "main.admin.nav.users",
  import: "main.admin.nav.import",
  betrieb: "main.admin.nav.ops",
  texte: "main.admin.nav.texts",
  kiosk: "main.admin.nav.kiosk",
  integrationen: "main.admin.nav.integrations",
  backup: "main.admin.nav.backup",
  design: "main.admin.nav.design",
  infos: "main.admin.nav.infos",
  sicherheit: "main.admin.nav.security",
  invites: "main.admin.nav.invites",
  audit: "main.admin.nav.audit"
} as const;

const coreAdminGroups: Record<AdminSection, AdminNavGroup> = {
  users: "people",
  import: "people",
  invites: "people",
  betrieb: "system",
  texte: "system",
  kiosk: "system",
  integrationen: "system",
  backup: "system",
  design: "system",
  infos: "system",
  sicherheit: "system",
  audit: "log"
};

const adminGroupOrder: AdminNavGroup[] = ["people", "system", "modules", "log"];

const adminGroupLabelKeys = {
  people: "main.admin.group.people",
  system: "main.admin.group.system",
  modules: "main.admin.group.modules",
  log: "main.admin.group.log"
} as const;

const profileLabelKeys = {
  konto: "main.profile.nav.account",
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

function profileModules(ctx: NavContext) {
  return (ctx.runtimeModules ?? [])
    .filter((info) => info.profile && info.clientUrl)
    .sort((a, b) => a.profile!.order - b.profile!.order || a.id.localeCompare(b.id));
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
            {ctx.currentUser && ctx.runtimeModules ? (
              <ModuleNotices modules={ctx.runtimeModules} locale={ctx.locale ?? "de"} user={ctx.currentUser} />
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
              showInfosLink={ctx.settings.infosEnabled}
            />
          ) : (
            <LoginRequired eyebrowKey="main.nav.mainEvents" />
          )
      },
      {
        // Unterseite von „Event" (kein eigener Hauptmenüpunkt, siehe Befund B4/P6): erreichbar
        // nur über `#main-events/infos`; `#infos` leitet dorthin weiter (normalizeLegacyHash).
        id: "infos",
        hash: "main-events/infos",
        order: 25,
        label: (t) => t("main.nav.infos"),
        icon: NAV_ICONS.infos,
        inMenu: () => false,
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
        // Sammelseite für alle Modulseiten (Befund B4): das Hauptmenü bleibt unabhängig von der
        // Zahl der Module. Alte Modul-Links `#m/<id>` leiten über den Alias `m` hierher weiter.
        id: "mitmachen",
        hash: "mitmachen",
        aliases: ["m"],
        order: 30,
        label: (t) => t("main.nav.mitmachen"),
        icon: NAV_ICONS.module,
        inMenu: (ctx) => Boolean(ctx.currentUser) && moduleMenuEntries(ctx.runtimeModules ?? []).length > 0,
        hero: (t) => ({
          eyebrow: t("main.route.mitmachen.eyebrow"),
          title: t("main.route.mitmachen.title"),
          description: ""
        }),
        subnavLabel: (t) => t("main.mitmachen.subnav"),
        subnav: (t, ctx) => {
          if (!ctx.currentUser) {
            return [];
          }
          const entries = moduleMenuEntries(ctx.runtimeModules ?? []);
          const entriesPerModule = new Map<string, number>();
          for (const { info } of entries) {
            entriesPerModule.set(info.id, (entriesPerModule.get(info.id) ?? 0) + 1);
          }
          // Gruppenüberschrift nur, wenn ein Modul mehr als einen Menüeintrag beisteuert (sonst
          // stünde der Modulname doppelt da, siehe `presence`/`pizza` mit je einem Eintrag).
          return entries.map(({ info, entry, slug }) => ({
            slug,
            label: entry.label,
            group: (entriesPerModule.get(info.id) ?? 0) > 1 ? info.name : undefined
          }));
        },
        render: (ctx) => {
          if (!ctx.currentUser) {
            return <LoginRequired eyebrowKey="main.nav.mitmachen" />;
          }
          const infos = ctx.runtimeModules ?? [];
          const entries = moduleMenuEntries(infos);
          const resolved =
            resolveModuleMenuEntry(infos, ctx.subPath) ?? (entries[0] ? { match: entries[0], innerSubPath: "" } : undefined);
          if (!resolved) {
            return <p className="muted">Noch keine Module aktiv.</p>;
          }
          return (
            <ModuleMenuEntryPage
              info={resolved.match.info}
              entry={resolved.match.entry}
              locale={ctx.locale ?? "de"}
              user={ctx.currentUser}
              subPath={resolved.innerSubPath}
            />
          );
        }
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
        subnav: (t, ctx) => {
          if (!isAdministrator(ctx.currentUser)) {
            return [];
          }
          const entries: Array<SubnavEntry & { groupKey: AdminNavGroup }> = [
            ...coreAdminSections.map((slug) => ({
              slug,
              label: t(coreAdminLabelKeys[slug]),
              groupKey: coreAdminGroups[slug]
            })),
            ...enabledModuleAdmin(ctx).map((entry) => ({
              slug: entry.slug,
              label: entry.label(t),
              groupKey: entry.group ?? "modules"
            }))
          ];
          // Nach Gruppen sortiert (stabil), damit die Seitenleiste zusammenhängende Blöcke zeigt.
          return adminGroupOrder.flatMap((groupKey) =>
            entries
              .filter((entry) => entry.groupKey === groupKey)
              .map(({ slug, label }) => ({ slug, label, group: t(adminGroupLabelKeys[groupKey]) }))
          );
        },
        render: (ctx: NavPageRenderContext) => {
          const slug = firstSegment(ctx.subPath);
          const moduleSection =
            isAdministrator(ctx.currentUser) ? enabledModuleAdmin(ctx).find((entry) => entry.slug === slug) : undefined;
          if (moduleSection) {
            return (
              <section className="admin-stage">
                <div className="admin-panel admin-panel--single admin-panel--module">{moduleSection.render(ctx)}</div>
              </section>
            );
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
            ? [
                ...profileSectionIds.slice(0, 1).map((slug) => ({ slug, label: t(profileLabelKeys[slug]) })),
                // Profilbereiche der Module direkt nach „Konto“ (z. B. Spielkonten aus „Spielt gerade“).
                ...profileModules(ctx).map((info) => ({ slug: `m-${info.id}`, label: info.profile!.label })),
                ...profileSectionIds.slice(1).map((slug) => ({ slug, label: t(profileLabelKeys[slug]) }))
              ]
            : [],
        render: (ctx) => {
          const slug = firstSegment(ctx.subPath);
          const moduleSection = slug.startsWith("m-")
            ? profileModules(ctx).find((info) => `m-${info.id}` === slug)
            : undefined;
          if (moduleSection && ctx.currentUser) {
            return <ModuleProfileSection info={moduleSection} locale={ctx.locale ?? "de"} user={ctx.currentUser} />;
          }
          const section: ProfileSectionId = (profileSectionIds as readonly string[]).includes(slug)
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
