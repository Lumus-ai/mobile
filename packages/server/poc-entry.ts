import { NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"

const main = Effect.scoped(
  Effect.gen(function* () {
    const { start } = yield* Effect.promise(() => import("@opencode/server/process"))
    const server = yield* start({
      hostname: "127.0.0.1",
      port: 4096,
      password: "poc",
      database: { path: process.env.POC_DB ?? "/tmp/opp-poc/opencode.db" },
    })
    yield* Effect.sync(() => console.log("POC-LISTENING", JSON.stringify(server.address)))
    return yield* server.shutdown
  }),
).pipe(
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
      replacements: [
        Global.node.replace(
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ),
      ],
    }),
  ),
  Effect.provide(NodeServices.layer),
)

Effect.runPromise(main as any).then(
  () => console.log("POC-EXIT-CLEAN"),
  (err) => { console.error("POC-FATAL", err); process.exit(1) },
)
