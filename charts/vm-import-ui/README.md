# vm-import-ui

Helm chart for the [Harvester VM Import UI](https://github.com/doccaz/vm-import-ui) —
a web interface for importing VMs from VMware vCenter into Harvester / SUSE
Virtualization, supporting both the VM Import Controller and Forklift engines.

## Installing

From the published Helm repo (GitHub Pages):

```bash
helm repo add vm-import-ui https://doccaz.github.io/vm-import-ui
helm repo update
helm install vm-import-ui vm-import-ui/vm-import-ui \
  --namespace vm-import-ui --create-namespace \
  --set service.nodePort=32000 \
  --set image.tag=latest
```

Then open `http://<any-node-ip>:32000` (the install notes print the exact URL),
or use the **VM Import UI** entry added to the Rancher / Harvester menu.

## How it authenticates

The pod talks to the cluster API using its **ServiceAccount** token — no external
kubeconfig is needed. An init container writes an in-cluster kubeconfig (CA cert
embedded) and the ClusterRole grants access to Harvester, KubeVirt, CDI, the VM
Import Controller (`migration.harvesterhci.io`), and Forklift
(`forklift.konveyor.io`) resources. If you hit `403` errors, extend
`templates/clusterrole.yaml`.

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `replicaCount` | `1` | Number of UI replicas |
| `image.repository` | `ghcr.io/doccaz/vm-import-ui` | Image repository |
| `image.tag` | chart `appVersion` | Image tag (`latest` for newest build) |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy |
| `service.type` | `NodePort` | Service type |
| `service.port` | `8080` | Service port |
| `service.nodePort` | `32000` | NodePort (30000–32767); `""` to auto-assign |
| `env.logLevel` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `env.useMockData` | `"false"` | Run in mock mode without a real cluster |
| `serviceAccount.create` | `true` | Create the ServiceAccount |
| `rbac.create` | `true` | Create the ClusterRole + binding |
| `navLink.enabled` | `true` | Create a Rancher NavLink (skipped if the `ui.cattle.io/v1` CRD is absent) |
| `navLink.label` | `VM Import UI` | Menu label |
| `navLink.group` | `Harvester` | Menu group |
| `navLink.url` | `""` | External link URL; blank links via the in-cluster Service proxy |
| `resources` | `{}` | Pod resource requests/limits |

## Rancher menu link (NavLink)

When `navLink.enabled` is true and the cluster has the `ui.cattle.io/v1` CRD
(Rancher-managed clusters, including Harvester), the chart creates a cluster-scoped
`NavLink` so the UI appears in the left-hand menu. Set `navLink.url` to an external
address (e.g. `http://<node-ip>:32000`) for a direct link; otherwise it points at
the in-cluster Service through Rancher's proxy.

## Uninstalling

```bash
helm uninstall vm-import-ui --namespace vm-import-ui
```
