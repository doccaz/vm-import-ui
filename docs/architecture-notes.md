# Architecture Notes

Background and design notes for the VM Import UI project. Originally written
as the project's `CLAUDE.md`; moved to `docs/` to keep the repo root clean.

## Project

Harvester VM Import UI - a web interface for importing virtual machines from VMware vCenter into Harvester/SUSE Virtualization clusters. Go backend (`pkg/`) serves a React frontend (`frontend/src/App.js`) and a REST API.

## Build & Run

```bash
# Container build (multi-stage: node:18 → golang:1.24 → SUSE BCI)
podman build -t vm-import-ui:local .

# Container run
podman run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e LOG_LEVEL=debug vm-import-ui:local
# NOTE: image runs as USER 1001. Under rootless podman the mounted kubeconfig must be
# world-readable (chmod 644) or the container exits with "/kubeconfig: permission denied".
# The UI is served at http://localhost:8080/ (root); /ui is the in-container asset path.

# Frontend development
cd frontend && yarn install && yarn start

# Frontend production build
cd frontend && yarn build

# Backend build
CGO_ENABLED=0 go build -v -o vm-import-ui ./pkg
```

Tests exist for both backend and frontend:
```bash
# Go backend tests
cd pkg && go test -v ./...

# Frontend tests
cd frontend && npx react-scripts test --watchAll=false
```

## Architecture

- **Backend** (Go, port 8080): Gorilla mux router serves the frontend from `/ui` and REST API under `/api/v1/*`
- **Frontend** (React 18, Tailwind CSS): Single monolithic `App.js` (~4200 lines) containing all components, state, and logic
- **Kubernetes**: Dynamic client for CRDs (`migration.harvesterhci.io/v1beta1`, `forklift.konveyor.io/v1beta1`), standard clientset for core resources (Secrets, Namespaces)
- **vCenter**: govmomi library for inventory browsing, VM power ops, rename, MAC updates
- **Two migration engines**: VM Import Controller (Harvester native) and Forklift (Konveyor project)

## Key Files

| File | Purpose |
|------|---------|
| `pkg/main.go` | Server setup, routing, static file serving |
| `pkg/handlers.go` | All REST API handlers (~2200 lines) |
| `pkg/support_bundle.go` | `GET /api/v1/support-bundle` — gathers a redacted diagnostics tar.gz |
| `pkg/types.go` | Go structs for CRD specs |
| `pkg/vcenter.go` | vCenter connectivity via govmomi |
| `pkg/k8s.go` | Kubernetes client init (in-cluster or kubeconfig fallback) |
| `frontend/src/App.js` | Entire React UI in one file |
| `frontend/src/utils.js` | Extracted utilities: `slugify`, `formatDuration/Date/Bytes`, `buildVmicPlan` (pure VMIC plan builder), `extractVms` (flatten inventory tree) |
| `pkg/handlers_test.go` | Go handler unit tests with fake K8s clients |
| `pkg/support_bundle_test.go` | Support-bundle tests (structure, secret redaction, scoping, anonymization) |
| `frontend/src/utils.test.js` | Utility tests + support-bundle inventory fixture replay |
| `frontend/src/App.test.js` | Component integration tests |
| `frontend/src/__fixtures__/bundles/` | Captured support-bundle data replayed through `buildVmicPlan` in tests |

## Important Patterns

- CRDs are accessed via unstructured dynamic client, not typed clients
- Creating a VmwareSource or ForkliftProvider also creates an associated Kubernetes Secret; deletion removes both
- Forklift plan creation creates NetworkMap + StorageMap + Plan CRs in a single API call; deletion cleans up all three
- Version detection reads `harvesterhci.io/v1beta1` settings to enable v1.6+ features (advanced power ops, disk bus type, preflight checks)
- Three UI themes (light, suse, dark) via CSS custom properties in `frontend/src/index.css`

## Support Bundle / Diagnostics

`GET /api/v1/support-bundle` (handler `pkg/support_bundle.go`, button on the About page) streams a redacted `vm-import-support-<ts>.tar.gz` of cluster + migration state. Every file is JSON so the bundle doubles as a test fixture.

**Query params:** `inventory=true` (opt-in live vCenter inventory, slow), `source=ns/name` (scope inventory to one VmwareSource), `anonymize=true` (hash identifying names in the inventory tree only).

**Contents:** `meta.json`, `errors.json`, `cluster/{capabilities,storageclasses,namespaces,networkattachmentdefinitions}.json`, raw CRs under `sources/{vmware,ova}/`, `providers/`, `plans/vmic/`, `plans/forklift/`, `forklift/{networkmaps,storagemaps,migrations}/` (full unstructured objects incl. `status.conditions` and `managedFields`), `secrets/*.json`, and (opt-in) `inventory/vmware_<ns>_<name>.json`. CR directories only appear when matching objects exist (e.g. no `forklift/networkmaps/` if no NetworkMaps).

**Design rules:**
- **Best-effort:** each gather step is panic/error-recovering — a missing optional CRD (Forklift not installed) records to `errors.json` and never aborts the bundle. Assembled in a buffer so a pre-write failure returns a clean 500.
- **Secret redaction:** `secrets/*.json` carry metadata + sorted `dataKeys` (key NAMES) only — values never leave the cluster.
- **Secret scoping:** only secrets *referenced* by sources (`spec.credentials.{name,namespace}`) and Forklift providers (`spec.secret.{name,namespace}`) are collected — NOT every cluster secret. Avoids noise and leaking unrelated secret names. (`safeList` discovers refs resiliently.)
- **Anonymization** (opt-in) hashes inventory VM/folder/datastore/network names with a per-bundle salt but preserves IDs/structure; CRs are *not* anonymized, so name-sensitive bugs won't reproduce from an anonymized bundle.

**Fixture replay:** drop a (redacted) bundle's `inventory/` dir under `frontend/src/__fixtures__/bundles/<name>/inventory/` and `utils.test.js` automatically flattens it (`extractVms`) and replays every VM through `buildVmicPlan`, asserting (among others) that `spec.virtualMachineName` keeps the raw, case-sensitive name. This is the regression harness for customer-reported plan-generation issues.

## Forklift Internals

Forklift (kubev2v/forklift, a.k.a. Migration Toolkit for Virtualization) is one of two migration engines supported. It uses its own set of CRDs under `forklift.konveyor.io/v1beta1`.

### CRD Overview

| CRD | Purpose |
|-----|---------|
| `Provider` | Source/destination infrastructure connection (vSphere, OVA, host) |
| `Plan` | Migration plan referencing a provider, VMs, NetworkMap, StorageMap |
| `NetworkMap` | Maps source networks to destination networks (pod/multus) |
| `StorageMap` | Maps source datastores/disks to destination storage classes |
| `Migration` | Execution instance of a Plan; naming convention: `{planName}-migration` |

### Provider CR Structure

```yaml
apiVersion: forklift.konveyor.io/v1beta1
kind: Provider
metadata:
  name: my-provider
  annotations:
    forklift.konveyor.io/empty-vddk-init-image: "yes"  # only when no VDDK image
spec:
  type: vsphere | ova       # "host" = destination provider (auto-managed)
  url: https://vcenter/sdk   # or host:/nfs-path for OVA
  secret:
    name: my-provider-secret
    namespace: forklift
  settings:                  # vSphere only
    sdkEndpoint: vcenter | esxi
    vddkInitImage: registry.example.com/vddk:v8.0.3  # optional, dramatically faster
```

### Provider Secret Format

**vSphere:**
| Key | Required | Description |
|-----|----------|-------------|
| `user` | Yes | vCenter/ESXi username |
| `password` | Yes | Password |
| `url` | Yes | API endpoint |
| `insecureSkipVerify` | No | `"true"`/`"false"` (default `"false"`) |
| `cacert` | No | PEM-encoded CA certificate for custom CAs |

**OVA:** Only `url` key (NFS path, e.g. `10.0.0.1:/exports/vms`).

### VDDK (Virtual Disk Development Kit)

- Container image containing VMware VDDK libraries for optimized disk transfer
- Set via `spec.settings.vddkInitImage` on the Provider
- **Required** for warm migrations and vSAN-backed VMs
- Without VDDK, cold migrations use a slower fallback method
- When no VDDK image is provided, annotation `forklift.konveyor.io/empty-vddk-init-image: "yes"` must be set
- Must be built from VMware's proprietary VDDK SDK (download from Broadcom/VMware)

### Plan Spec Fields

| Field | Default | Description |
|-------|---------|-------------|
| `warm` | false | Enable warm migration (precopy while VM runs, then cutover) |
| `migrateSharedDisks` | true | Include disks shared between VMs |
| `preserveClusterCpuModel` | false | Preserve source cluster CPU model on target |
| `preserveStaticIPs` | false | Preserve static IP configurations |
| `targetNamespace` | — | Destination namespace for migrated VMs |

### OVA Provider Differences

- Provider `type: ova`, Secret only needs `url` key (NFS path)
- Forklift auto-deploys an OVA server pod that scans NFS for OVF files
- Inventory fetched via proxy through `forklift-inventory` service using provider UID
- **StorageMap** uses `source.name` (disk filename) — NOT `source.id` like vSphere
- **NetworkMap** uses `source.id` (OVF hash)
- Only cold migration supported (no warm)
- Storage model is per-disk, not per-datastore

### Atomic Create/Delete Pattern

- **Create Plan API**: Creates NetworkMap + StorageMap + Plan in one call; rolls back on failure
- **Delete Plan API**: Deletes Plan + NetworkMap + StorageMap + associated Migration CR
- **Create Provider API**: Creates Secret + Provider CR; rolls back Secret on Provider failure
- **Delete Provider API**: Deletes Provider CR + associated Secret

### Plan Generation Constraints & Known Bugs

- **One VM per Forklift plan**: the wizard submits `vms: [{ id: selectedVm.id }]` (`App.js` `handleSubmit`), so each plan targets a single VM. The NetworkMap/StorageMap are derived from that one VM (`sourceNetworks` / `sourceDatastores` memos in `App.js`), not from a multi-VM selection.
- **Single-datastore StorageMap (latent bug)**: inventory records only `mvm.Datastore[0]` per VM (`pkg/vcenter.go` ~L254), and the StorageMap is built from that single `selectedVm.datastoreId` (`App.js` `sourceDatastores` memo). A VM with disks spanning **multiple datastores** produces an incomplete StorageMap → Forklift rejects the plan with an unmapped-storage error. Fix would require collecting all distinct datastores across the VM's disks.
- **NetworkMap source key**: Forklift maps by network moref (`net.id`, e.g. `network-97256`), VMIC maps by network name. Discovery (`pkg/vcenter.go` `findNetworks`) emits `{Name, ID, MAC, Key}` per NIC; for standard vSwitch backings `Name`=portgroup `DeviceName` and `ID`=`network-NNN`, for distributed vSwitch `ID`=portgroup key and `Name`=`dvSwitch/pg`.
- **Plan creation is not logged**: the create handlers (`handlers.go` `CreateForkliftPlanHandler`) emit no debug log of the generated CRDs. A debug log will show the inventory fetch (`Fetching inventory...` → per-VM `Successfully found networks` → `Constructed vCenter inventory tree`) but never the plan POST. To debug a generated plan, inspect the CRs (`kubectl get plan/networkmap/storagemap -o yaml`) or the Forklift Plan status conditions, not the app log.
- **VMIC `virtualMachineName` must NOT be slugified** (fixed): `spec.virtualMachineName` is the case-sensitive source identifier VMIC uses to locate the VM in vCenter, so it must be the **raw** name (`selectedVm.name` / `ovaVmName`). Only `metadata.name` gets `slugify()` (RFC-1123). A prior bug slugified the source name (`VMDEVOPSTSTWIN01` → `vmdevopststwin01`), so the controller couldn't find the VM and set status `virtualMachineImportInvalid`. Symptom in a captured CR: `managedFields` show `rancher` later patching `spec.virtualMachineName` back to the correct case (manual fix).

## vCenter User — Minimum Required Privileges (VMIC)

Derived from every govmomi call in `pkg/vcenter.go`. Apply the role at the **datacenter** level with **Propagate to children** — the property collector traverses the full tree from datacenter root.

### Always required (read / inventory)

| Privilege | Reason |
|-----------|--------|
| `System.Anonymous` | Session establishment |
| `System.View` | Inventory traversal via `find.NewFinder` |
| `System.Read` | All `RetrieveOne` / property collector calls |
| `VirtualMachine.Provisioning.DiskRandomRead` | NBD disk read during import |
| `VirtualMachine.Provisioning.GetVmFiles` | Reading VM files during export |

### Required only if using power-op buttons in the UI

| Privilege | Operation |
|-----------|-----------|
| `VirtualMachine.Interact.PowerOn` | Power On |
| `VirtualMachine.Interact.PowerOff` | Power Off (also fallback for failed guest shutdown) |
| `VirtualMachine.Interact.Reset` | Reset |
| `VirtualMachine.Interact.GuestControl` | Shut Down Guest (graceful) |

### Required only if using rename / MAC-update features

| Privilege | Operation |
|-----------|-----------|
| `VirtualMachine.Config.Rename` | `RenameVM` |
| `VirtualMachine.Config.EditDevice` | `UpdateVMNetworkMAC` (ReconfigVM with device change) |

### Explicitly NOT needed

`Datastore.*` (write), `Network.*` (write), `VirtualMachine.Inventory.Create/Delete/Move`, `VirtualMachine.Provisioning.Clone`, `Resource.*`, `Snapshot.*` — VMIC reads disks over NBD and never writes back to vCenter or manages snapshots.

## Helm Chart NavLink — Scope Limitation

`charts/vm-import-ui/templates/navlink.yaml` creates a cluster-scoped `ui.cattle.io/v1 NavLink` (gated on `.Capabilities.APIVersions.Has "ui.cattle.io/v1"`, so it no-ops on plain Kubernetes). This CRD only feeds the **generic Rancher cluster-explorer side-nav** — the one reached via **Support → Access Embedded Rancher UI** on a SUSE Virtualization/Harvester box. It does **not** appear in the **main Harvester/SUSE Virtualization product UI** (Dashboard, Hosts, VMs, Volumes, Images, …).

As of Rancher 2.10+, that main product UI is itself shipped as a Rancher UI Extension (`harvester/harvester-ui-extension`, built on `@rancher/shell`) with its own statically-defined nav/route tree — it doesn't consult `NavLink` CRs. Adding a link into that native nav would require building and publishing a real UI Extension (routes registered via `plugin.addRoutes()` targeting `meta.product: 'harvester'`, packaged behind a `UIPlugin` CR under `catalog.cattle.io/v1`), not just a Helm-templated CR. Investigated 2026-07-08 and deliberately deferred — the NavLink-only approach was judged good enough for the gain; do not re-attempt this as a quick chart tweak.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `KUBECONFIG` | `/kubeconfig` | Path to kubeconfig file |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `UI_PATH` | `/ui` | Path to frontend build directory |
| `USE_MOCK_DATA` | `false` | Run without a Kubernetes cluster |
