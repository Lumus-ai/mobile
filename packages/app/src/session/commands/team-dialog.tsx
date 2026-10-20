import { Component, createResource } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useData, useServer } from "@/runtime/server/current"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { List } from "@opencode/ui/list"
import { showToast } from "@/shell/notifications/toast"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { sessionHref } from "@/shell/routes/session"

// "Create team": opens an Orchestrator project in the current directory with the chosen team template
// (one session per role) and jumps to the Orchestrator's main session, which dispatches the team.
export const DialogTeam: Component = () => {
  const navigate = useNavigate()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const dialog = useDialog()
  const server = useServer()
  const [templates] = createResource(() => serverSDK.api.orchestra.template.list())

  const create = (template: { id: string; name: string } | undefined) => {
    if (!template) return
    const directory = location().directory
    const base = directory.split("/").filter(Boolean).pop() ?? "project"
    serverSDK.api.orchestra.project
      .create({ name: `${base} · ${template.name}`, directory, template: template.id })
      .then((project) => serverSDK.api.orchestra.project.main({ projectID: project.id }))
      .then((main) => {
        data.session.remember(main)
        dialog.close()
        navigate(sessionHref(server.key, main.id))
      })
      .catch((cause: unknown) => {
        showToast({
          variant: "error",
          title: "Could not create the team",
          description: cause instanceof Error ? cause.message : String(cause),
        })
      })
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>Create team</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p class="px-4 pb-2 text-text-weak">
          Pick a team template. The Orchestrator opens in this project and dispatches the team agents for you.
        </p>
        <List
          class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          search={{ placeholder: "Search templates", autofocus: false }}
          emptyMessage={templates.error ? "Could not load templates" : "No templates"}
          key={(x) => x.id}
          items={() => templates() ?? []}
          filterKeys={["name", "description"]}
          onSelect={create}
        >
          {(item) => (
            <div class="w-full flex flex-col gap-0.5 text-left">
              <span class="font-medium">{item.name}</span>
              <span class="text-text-weak text-sm">
                {item.description} ({item.members.length})
              </span>
            </div>
          )}
        </List>
      </DialogBody>
    </Dialog>
  )
}
