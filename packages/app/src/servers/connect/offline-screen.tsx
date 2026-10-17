import { createSignal, For } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useI18n } from "@opencode/ui/context/i18n"
import { useLanguage } from "@/runtime/i18n/language"
import { NewSessionWordmark } from "@/new-session/wordmark"
import { NEW_SESSION_CONTENT_WIDTH } from "@/new-session/layout"
import { useNavigate } from "@solidjs/router"
import { MobileDrawer, MobileDrawerContent, MobileDrawerLabel } from "@/shell/mobile-drawer"
import { usePlatform } from "@/runtime/platform/platform"
import "@/composer/editor/editor.css"

const MINI_SKILLS = [
  { icon: "🔎", label: "Analyze" },
  { icon: "🧭", label: "Plan" },
  { icon: "🐛", label: "Debug" },
  { icon: "🧐", label: "Review" },
  { icon: "🧪", label: "Test" },
  { icon: "💡", label: "Explain" },
]

/**
 * No servers saved yet: show the regular new-session main screen (wordmark,
 * mini-skill chips, composer, project line, footer) exactly as it looks when
 * connected. Everything is inert: nothing opens the connect screen on tap.
 * Connecting a server is only reachable manually from the left menu or
 * Settings > Servers.
 */
export function OfflineHomeScreen() {
  const language = useLanguage()
  const i18n = useI18n()
  const platform = usePlatform()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = createSignal(false)

  // Launch screen is inert without a server: nothing auto-opens the connect
  // screen. It is reachable only manually from the left menu (Servers) or
  // Settings > Servers.
  const noop = (event?: Event) => {
    event?.preventDefault()
    event?.stopPropagation()
  }

  return (
    <>
      <MobileDrawer side="left" open={menuOpen()} onOpenChange={setMenuOpen}>
        <MobileDrawerContent side="left">
          <MobileDrawerLabel class="sr-only">{language.t("home.projects")}</MobileDrawerLabel>
          <div data-slot="mobile-menu" data-corvu-no-drag class="flex min-h-0 flex-1 flex-col gap-1">
            <button
              type="button"
              data-action="mobile-menu-settings"
              class="flex h-8 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02"
              onClick={() => {
                setMenuOpen(false)
                navigate("/settings")
              }}
            >
              <Icon name="settings-gear" size="small" />
              {language.t("sidebar.settings")}
            </button>
            <button
              type="button"
              data-action="mobile-menu-help"
              class="flex h-8 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02"
              onClick={() => {
                setMenuOpen(false)
                platform.openExternal("https://opencode.ai/desktop-feedback")
              }}
            >
              <Icon name="help" size="small" />
              {language.t("sidebar.help")}
            </button>
          </div>
        </MobileDrawerContent>
      </MobileDrawer>
      <div
        class="@container relative flex h-full min-h-0 flex-1 flex-col bg-v2-background-bg-deep"
        style={{ "padding-top": "env(safe-area-inset-top, 0px)" }}
      >
        <div class="flex h-12 shrink-0 items-center gap-1.5 px-2">
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="!w-9 shrink-0"
            icon={<Icon name="menu" />}
            aria-label={language.t("home.projects")}
            onClick={() => setMenuOpen(true)}
          />
          <div class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-v2-text-text-base" onClick={noop}>
            <Icon name="edit" class="shrink-0 text-v2-icon-icon-base" />
            <span class="min-w-0 flex-1 truncate text-[13px] leading-4">{language.t("session.tab.session")}</span>
            <span class="shrink-0 text-[13px] leading-4 text-v2-text-text-muted">1</span>
          </div>
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="!w-9 shrink-0"
            icon={<Icon name="plus" />}
            aria-label={language.t("command.session.new")}
            onClick={noop}
          />
        </div>
        <div
          class="flex min-h-0 flex-1 flex-col p-2 pt-0 max-md:p-1 max-md:pt-0"
          style={{ "padding-bottom": "max(4px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div
            data-component="new-session"
            class="relative min-h-0 flex-1 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
          >
            <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6 max-md:top-1/2 max-md:-translate-y-1/2">
              <div class={NEW_SESSION_CONTENT_WIDTH}>
                <NewSessionWordmark />
                <div class="mt-8 flex flex-col gap-8">
                  <div class="flex flex-col gap-3">
                    <div data-component="composer-mini-skills" class="flex min-w-0 flex-col gap-2">
                      <div class="flex min-w-0 flex-wrap items-center gap-1">
                        <For each={MINI_SKILLS}>
                          {(item) => (
                            <Button
                              type="button"
                              size="small"
                              variant="ghost-muted"
                              class="max-w-[220px] gap-1.5"
                              title={item.label}
                              onClick={noop}
                            >
                              <span aria-hidden="true">{item.icon}</span>
                              <span class="truncate">{item.label}</span>
                            </Button>
                          )}
                        </For>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost-muted"
                          class="gap-1.5"
                          aria-label={language.t("composer.miniSkills.manage")}
                          title={language.t("composer.miniSkills.manage")}
                          onClick={noop}
                        >
                          <Icon name="sliders-horizontal" size="small" />
                        </Button>
                        <Button type="button" size="small" variant="ghost-muted" class="gap-1.5" onClick={noop}>
                          <Icon name="plus" size="small" />
                          <span>{language.t("composer.miniSkills.add")}</span>
                        </Button>
                      </div>
                    </div>
                    <div
                      data-component="composer"
                      class="group/composer relative min-h-[96px] w-full cursor-text overflow-clip rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
                      onClick={noop}
                    >
                      <div class="min-h-[60px] px-4 pt-4 pb-2">
                        <div class="text-[13px] font-[440] leading-5 text-v2-text-text-faint">
                          {i18n.t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" })}
                        </div>
                      </div>
                      <div class="flex h-11 items-center px-2" onClick={noop}>
                        <div class="flex shrink-0 items-center">
                          <IconButton
                            data-action="composer-attach"
                            type="button"
                            icon={<Icon name="plus" />}
                            variant="ghost-muted"
                            size="large"
                            aria-label={i18n.t("ui.promptInput.add")}
                            onClick={noop}
                          />
                        </div>
                        <div class="ms-1 me-3 flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
                          <Button
                            type="button"
                            variant="ghost-muted"
                            size="normal"
                            style={{ height: "28px" }}
                            class="min-w-0 max-w-[220px] justify-start ![font-weight:440] group"
                            onClick={noop}
                          >
                            <span class="truncate leading-4">{language.t("dialog.model.select.title")}</span>
                            <span class="-ml-0.5 -mr-1 flex shrink-0">
                              <Icon name="chevron-down" />
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost-muted"
                            size="normal"
                            style={{ height: "28px" }}
                            class="min-w-0 max-w-[220px] justify-start ![font-weight:440] group"
                            onClick={noop}
                          >
                            <span class="truncate leading-4">Default</span>
                            <span class="-ml-0.5 -mr-1 flex shrink-0">
                              <Icon name="chevron-down" />
                            </span>
                          </Button>
                        </div>
                        <div class="flex shrink-0 items-center">
                          <IconButton
                            data-action="composer-submit"
                            type="button"
                            icon={<Icon name="arrow-up" />}
                            variant="submit"
                            class="size-7 rounded-md p-[6px] opacity-50"
                            aria-label={i18n.t("ui.promptInput.send")}
                            onClick={noop}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="flex min-h-7 min-w-0 flex-row flex-wrap items-center gap-0 text-v2-text-text-faint">
                    <button
                      data-action="prompt-project"
                      type="button"
                      class="flex h-7 min-w-0 max-w-[160px] items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                      onClick={noop}
                    >
                      <Icon name="folder-add-left" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                      <span class="min-w-0 truncate leading-5">{language.t("session.new.project.new")}</span>
                      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="pointer-events-none absolute inset-x-0 bottom-6 hidden max-md:flex items-center justify-between px-6 font-mono text-[10.5px] text-v2-text-text-faint">
              <span>0 MCP&nbsp;&nbsp;/status</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
