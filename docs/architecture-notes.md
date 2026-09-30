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
| `pkg/ovf.go` | KubeVirt VM → OVF descriptor; the three target profiles |
| `pkg/ova.go` | OVA tar assembly: USTAR, member order, chunking, manifest |
| `pkg/export.go` | Export HTTP handlers, preview, download, status |
| `pkg/export_job.go` | Builds the export Job (the export's state record) |
| `pkg/export_worker.go` | `export-worker` mode: qemu-img → descriptor → OVA |
| `pkg/harvester_inventory.go` | Cluster-wide Harvester VM tree for the Export page |
| `pkg/testdata/xsd/` | Vendored DMTF schemas (see the README there) |
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

## VM Export (Harvester → OVA)

Exports a Harvester/KubeVirt VM as a DSP0243-conformant OVA. The reverse of the
import path, and the source of a free round-trip test: export to the share, then
re-import through this app's own Forklift OVA provider.

### Pipeline

```
stopped VM ─► PVC mounted read-only as a block device in a Job
           ─► qemu-img convert -f raw  ─► staged disk on the export volume
           ─► BuildOVF (descriptor)    ─► WriteOVA (USTAR tar) ─► <name>.ova
```

### Why not KubeVirt VirtualMachineExport

`export.kubevirt.io/v1beta1` and the `virt-exportproxy` Service both exist on
Harvester, which makes VMExport look available — but creating one is rejected
with `vm export feature gate not enabled`. KubeVirt's live gates on Harvester
1.8.1 do not include `VMExport`, and the `KubeVirt` CR is owned by the Harvester
Helm release *and* Fleet, so enabling it by hand is reverted. We therefore read
the PVCs directly, behind a `DiskSource` seam so a VMExport backend can be added
for clusters that do enable the gate.

### The safety property that matters most

Harvester's VM disks are **ReadWriteMany Block** volumes. A Job *can* mount and
read one while the VM is running, and nothing in Kubernetes prevents it — the
result is a torn, inconsistent image with no error anywhere. VMExport would have
enforced this for us; reading PVCs directly makes it ours to enforce:

- `exportBlockers` marks a running VM as non-exportable in the inventory, and
  **fails closed** if the VMI list cannot be read.
- `CreateExportHandler` re-checks for a VirtualMachineInstance immediately
  before creating the Job, rather than trusting what the UI showed minutes ago.
- Source PVCs are mounted `readOnly: true`.

### Format rules (DSP0243 v2.1.1)

| Rule | Clause | Where |
|------|--------|-------|
| USTAR tar format | 485–486 | `ova.go`, `tar.FormatUSTAR` pinned |
| Member order: `.ovf`, `.mf`, then References order | 469–474 | `WriteOVA` |
| Entries appear only once | 462 | `PlanChunks` rejects duplicates |
| Manifest grammar `SHA256(name)= <hex>\n` | 415–421 | `BuildManifest` |
| SHA256 required | 406 | — |
| `.mf`/`.cert` not in References | 443–446 | — |
| Chunking via `ovf:chunkSize`, 9-digit suffixes | 542–556 | `PlanChunks` |
| Descriptor validates against DSP8023 | 493 | vendored XSD + `xmllint` |

**USTAR caps a member at 8 GiB − 1** (12-byte octal size field). Real disks can
exceed that, so files over that limit are chunked — which is the spec's own
remedy for "file size restrictions on certain file systems", not a workaround.
`defaultChunkSize` is pinned to the USTAR cap itself, not DSP0243 Annex D.4's
2 GiB worked-example value: chunking below the point where it's structurally
required buys nothing and costs compatibility — `virt-v2v`'s `-i ova` input
misreads multiple chunk files as a VMware CBT snapshot chain and silently
converts only the last one instead of the whole disk
([libguestfs/virt-v2v#189](https://github.com/libguestfs/virt-v2v/issues/189)).

When a disk does have to be split, the chunk size is rounded down to a multiple
of 512 (`chunkAlign`), i.e. `2^33 - 512` rather than `2^33 - 1`. A disk that fits
in one member is still not chunked. The alignment lets a consumer present the
chunks as one disk without copying them (`virt-v2v` can describe them as one
VMDK with a `FLAT` extent per chunk, counted in sectors); with unaligned chunks
it has to concatenate the whole disk into a temporary file first.

### Profiles

| | `vmware` (default) | `portable` | `faithful` |
|---|---|---|---|
| Target | vSphere / ESXi | VirtualBox, Proxmox, oVirt | KVM / libvirt |
| Disk format | streamOptimized VMDK | streamOptimized VMDK | qcow2 |
| Disk controller | LSI Logic SCSI | LSI Logic SCSI | virtio |
| NIC | E1000E | E1000 | preserved |
| Boots on ESXi | yes | yes | **no** |

`faithful` uses qcow2 because `qemu-img`'s VMDK `adapter_type` accepts only
`ide|lsilogic|buslogic|legacyESX` — no virtio — so a "faithful" VMDK would have
to misdeclare its adapter. The `ovf:version` attribute is largely cosmetic:
ovftool derives the version it reports from the envelope namespace and ignores
the attribute.

### Not representable in OVF

| KubeVirt concept | Handling |
|---|---|
| `cloudInitNoCloud` volume | **Excluded.** It carries SSH keys and passwords; exporting it would leak them into a file users pass around. |
| PVC- or container-backed CD-ROM | Declared as an *empty* IDE drive; the backing ISO is not exported. |
| Multus NAD / VLAN | Only the network *name* reaches `<NetworkSection>`. |
| affinity, evictionStrategy, runStrategy | Dropped. |
| Longhorn replica count, storage class | Dropped. |

### Architecture

- **The Job is the state.** No ConfigMap store and no in-memory map: the Job
  lives in the VM's namespace, carries export metadata in labels/annotations, and
  is what the API lists. Restart-safe and replica-safe, with no extra RBAC.
- **The worker has no cluster access** (`automountServiceAccountToken: false`).
  Its whole instruction set arrives via `EXPORT_SPEC` and mounted volumes.
- **One binary, two modes.** `vm-import-ui export-worker` runs inside the Job;
  same image, one version to keep in sync. The image carries `qemu-img`.
- **`backoffLimit: 0`** — retrying re-reads and re-converts every byte.
- **Progress** is a `status.json` on the export volume, since the worker cannot
  talk to the API server. The API falls back to Job status plus pod logs.

### Validation

`pkg/ova_test.go` and `pkg/ovf_test.go` cover the format offline (golden files,
member order, USTAR magic, chunk suffixes, byte-exact manifest). Beyond that,
four independent implementations are used, each catching what the others cannot:

| Tool | Checks | Availability |
|------|--------|--------------|
| `xmllint` + vendored DSP8023 | descriptor schema | always (CI) |
| `virt-v2v` | descriptor semantics; **verifies disk digests** | distro package |
| `ovftool --schemaValidate` + probe | VMware vendor rules, `vmw:Config` | opt-in, `PATH` |
| VDDK `vmware-vdiskmanager -R` | VMDK readable by VMware's own library | opt-in, `VDDK_IMAGE` |

### 🔴 Guest preparation is required before exporting to VMware

**A correctly-formed OVA is not enough for the guest to boot.** This was proven
end to end: `labs/rhel9` was exported, deployed to ESXi 8.0.3 — where ESXi built
exactly the hardware we declared — powered on, and dropped into dracut emergency
mode:

```
Warning: /dev/mapper/rhel-root does not exist
Entering emergency mode.
dracut:/# ls /dev/sd* /dev/vd*
ls: cannot access '/dev/sd*': No such file or directory
ls: cannot access '/dev/vd*': No such file or directory
dracut:/# modprobe mptspi
modprobe: FATAL: Module mptspi not found in directory /lib/modules/5.14.0-687.5.3.el9_8.x86_64
```

No block devices at all, and the LSI Logic driver is not merely unloaded — it is
**absent from the initramfs**. Distro installers build a *host-only* initramfs
containing drivers for the hardware present at install time. A VM installed on
Harvester therefore has a virtio-only initramfs, and the `vmware` and `portable`
profiles necessarily remap virtio to hardware VMware implements (LSI Logic,
E1000E). The guest then cannot see its own root disk.

This is **not an OVF defect** — the package validates against DSP8023, ovftool,
virt-v2v and VDDK, and ESXi built the right devices. It is a guest-side
constraint that no exporter can fix from outside the disk image.

**Fix, applied inside the guest before exporting:**

```bash
# RHEL / SLES / Fedora (dracut)
dracut --regenerate-all --force --no-hostonly
# or, more surgically:
dracut --force --add-drivers "mptspi mptsas vmw_pvscsi ata_piix ahci sd_mod"

# Debian / Ubuntu (initramfs-tools): set MODULES=most, then
update-initramfs -u -k all
```

Then power the VM off and export it.

#### Fixing an image that was already exported — verified

`virt-v2v` cannot do this: its output modes are KVM-family only
(`disk|glance|kubevirt|libvirt|openstack|ovirt|qemu|vdsm`) — it converts *from*
VMware, not *to* it. Its sibling **`virt-customize`** (libguestfs) can, and the
whole round trip was verified end to end on the failing `labs/rhel9` export:

```bash
# stream-optimized VMDK is effectively write-once, so work in qcow2
tar xf rhel9.ova && cat disk-0.vmdk.0000000* > whole.vmdk
qemu-img convert -f vmdk -O qcow2 whole.vmdk work.qcow2          # ~26s
virt-customize -a work.qcow2 \
  --run-command 'dracut --regenerate-all --force --no-hostonly'  # ~60s
qemu-img convert -f qcow2 -O vmdk \
  -o subformat=streamOptimized,adapter_type=lsilogic work.qcow2 disk-0.vmdk
# then repackage with BuildOVF + WriteOVA
```

Before: the initramfs contained **zero** of `mptspi|mptsas|vmw_pvscsi`.
After: `mptspi`, `mptsas`, `vmw_pvscsi`, `ahci`, `ata_piix`, `sd_mod` all present.
`virt-customize` also handles SELinux relabelling, which a hand-rolled fix would
miss and which would otherwise break the boot in a different way.

Redeployed to ESXi 8.0.3, the same image booted to a graphical login with
`toolsRunningStatus=guestToolsRunning` and the preserved MAC connected — same
kernel, same pipeline, initramfs the only variable.

**Possible future feature:** the export worker could run this automatically as an
opt-in "prepare for VMware" step. It would need libguestfs + qemu in the image
(large), and `/dev/kvm` in the Job for acceptable speed (on Harvester, via the
`devices.kubevirt.io/kvm` device plugin) — without KVM, libguestfs falls back to
TCG and is far slower. It also mutates the guest, so it must never be the
default.

Windows guests need the equivalent done beforehand (the LSI/pvscsi storage
driver present and its boot-start registry entry enabled); otherwise they
INACCESSIBLE_BOOT_DEVICE for the same reason.

The `faithful` profile does not have this problem — it preserves virtio — but
its packages only import into KVM/libvirt.

### Automated guest preparation — investigated and deferred

Automating the initramfs rebuild inside the export Job was costed and rejected in
favour of the one-line in-guest `dracut` command above. Recorded here so it is
not re-investigated from scratch.

`virt-v2v` cannot do it: its output modes are `disk|glance|kubevirt|libvirt|
openstack|ovirt|qemu|vdsm` — KVM-family only. It converts *from* VMware, not to
it. `virt-customize` (libguestfs) can, and was verified end to end, but shipping
it costs:

| Image | Measured size |
|---|---|
| `bci-base:15.7` / `bci-base:16.1` | 125 MB / 99.7 MB |
| + `qemu-tools` (what the export worker needs today) | ~201 MB |
| + `guestfs-tools` + kernel, on 15.7 (whole stack from Leap 15.6) | **712 MB** |
| + `guestfs-tools` + kernel, on 16.1 (only the kernel from Leap 16.0) | **763 MB** |

Projected for a `vm-import-ui` image (binary ~64 MB + UI ~2 MB on top): ~267 MB
today, ~829 MB with the prep step — roughly 3x.

Findings if this is ever revisited:

- **`guestfs-tools` is not in the public SLE_BCI 15.x repo at all**; on **16.1 it
  is**, which is the main reason to prefer 16.1 despite the slightly larger
  result. On 15.x the entire virt stack has to come from openSUSE Leap.
- **libguestfs has no prebuilt appliance on SUSE.** supermin builds one at first
  run and needs a real kernel to copy, but BCI ships only `kernel-*-devel` — so
  even on 16.1 the kernel must come from Leap. An untested idea that could
  reclaim most of that ~127 MB: build the appliance in a multi-stage build and
  ship only the resulting kernel+initrd, dropping `kernel-default`.
- On 16.1 supermin additionally needs **`zstd`** (Leap 16 modules are `.ko.zst`
  and it shells out to `zstdcat`) and **`cpio`** (it builds the initrd with it).
  Neither is in the base image; both failures surface as an opaque
  `supermin exited with error status 1`.
- The Job would need **`/dev/kvm`** (on Harvester, the `devices.kubevirt.io/kvm`
  device plugin). Without it libguestfs falls back to TCG and is far slower. With
  KVM the appliance builds in ~3 s.
- It mutates the guest, so it could never be the default.

If it is built, the chart already supports it without inflating the base install:
`export.image.repository` is a separate value defaulting to the main image, so a
fat `vm-import-ui-guestfs` image can be pointed at only when the feature is
wanted. The API pod would never carry libguestfs.

**Why deferred:** the in-guest `dracut --regenerate-all --no-hostonly` is free,
one line, works on guests the exporter never touches, and needs no 800 MB image
or KVM device request. Automating it only pays off for bulk migrations where
nobody can prepare the guests first.

### Verified against a real ESXi 8.0.3 host

An OVA produced by the worker was deployed with `ovftool` to a standalone ESXi
8.0.3 host, and every declaration survived the round trip into real VM hardware:

| Descriptor says | ESXi created |
|---|---|
| `vssd:VirtualSystemType` = `vmx-15` | HW version vmx-15 |
| `vmw:Config key="firmware" value="bios"` | Firmware: bios |
| `rasd:ResourceSubType` = `lsilogic` (RT 6) | LSI Logic Parallel controller |
| `rasd:ResourceSubType` = `E1000E` (RT 10) | E1000E NIC, MAC preserved |
| CD-ROM (RT 15) parented to the IDE controller | CD-ROM on IDE controller |
| memory `byte * 2^20`, VirtualQuantity 4096 | 4096 MB |

This is what confirmed the `vmw:Config` **firmware** key, which was otherwise
guesswork — no schema, and neither virt-v2v nor ovftool's own probe, can tell you
whether VMware actually honours a vendor extension.

`ovftool`'s *deploy* path prints "The manifest validates" and verifies disk
digests, including chunked ones — so chunking is confirmed correct by VMware's
own implementation, not just by our tests.

**Gotcha when the host is behind a proxy.** Uploading a multi-gigabyte OVA
through Cloudflare fails at ~98 MiB with a misleading message:

```
Error: Failed to send file [...], please check the network connection
```

The real cause only appears with `--X:logFile`: `(response code:413)` — the
proxy's request-body cap (100 MB on Cloudflare's free/pro tiers). ovftool sends
each disk as a single request, so it cannot be chunked around. Deploy against the
host's own address rather than a proxied name.

ovftool and VDDK are proprietary and **must not be redistributed**: they are
never vendored, fetched by the build, or added to the image. Their tests skip
unless the tool is already present. Note ovftool's probe verifies the
*descriptor's* digest but not the disks'; virt-v2v verifies both.

## vCenter User — Minimum Required Privileges (VMIC)

> **Import only.** These privileges cover the vCenter → Harvester *import* path.
> The Harvester → OVA *export* feature never contacts vCenter; its permissions
> are Kubernetes RBAC (see the chart's ClusterRole and the VM Export section).
> In particular `VirtualMachine.Provisioning.GetVmFiles` below is listed with the
> reason "reading VM files during export" — that refers to VMIC reading a *source*
> VM, not to this feature.

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
| `EXPORT_ROOT` | — | This pod's mount of the export volume; unset disables status reads and downloads |
| `EXPORT_PVC` | — | Name of the RWX claim the export Jobs mount. A VM's Job runs in the VM's own namespace (a PVC cannot be mounted across namespaces), so outside this pod's own namespace a claim of this name is auto-created there — see `EXPORT_STORAGE_CLASS`/`EXPORT_STORAGE_SIZE` and `POD_NAMESPACE` below |
| `EXPORT_IMAGE` | — | Image the export Jobs run (normally this same image) |
| `EXPORT_STORAGE_CLASS` | cluster default | StorageClass for an `EXPORT_PVC` auto-created in a VM's namespace |
| `EXPORT_STORAGE_SIZE` | `200Gi` | Size for an `EXPORT_PVC` auto-created in a VM's namespace |
| `POD_NAMESPACE` | — | This pod's own namespace (downward API). Used to tell whether `EXPORT_ROOT` is actually the export's volume before trusting it for progress/downloads — unset falls back to always trusting `EXPORT_ROOT`, matching single-namespace behaviour |
| `EXPORT_MAX_CONCURRENT` | `2` | Simultaneous export Jobs |
| `EXPORT_TTL_SECONDS` | `3600` | How long finished export Jobs are kept |
| `EXPORT_DOWNLOAD_MAX_BYTES` | `2147483648` | Server-side cap on browser downloads |
| `EXPORT_RUN_AS_USER` / `EXPORT_FS_GROUP` | `0` | Job security context; block devices land as `root:disk` |
| `EXPORT_SPEC` | — | Worker only: the JSON instruction set |

### Cross-namespace export storage

Export Jobs mount the VM's own PVCs read-only as block devices, which forces
the Job into the VM's namespace — PVCs are namespace-scoped, full stop. Since
this app's cluster-wide VM browser routinely exports VMs outside its own
release namespace, the chart's `export-pvc.yaml` (which only creates a claim in
the release namespace) is not sufficient on its own: `ensureExportPVC`
(`pkg/export.go`) auto-provisions a same-named RWX claim in the VM's namespace
on first export there, sized/classed from `EXPORT_STORAGE_CLASS` /
`EXPORT_STORAGE_SIZE` (`export.storage.storageClass` / `export.storage.size` in
the chart).

That leaves progress reads and downloads only working for exports whose Job
landed in this pod's own namespace, because `EXPORT_ROOT` is this pod's mount
of *its own* namespace's claim — a different physical volume from any other
namespace's auto-created claim. `exportVolumeMountedHere` gates on
`POD_NAMESPACE` to report that honestly (`downloadable: false` with a
`volumeNote`, and a clear 503 from `DownloadExportHandler`) rather than
silently reading the wrong volume or claiming a real OVA "was not found".

An admin who wants downloads to work everywhere can point
`export.storage.existingClaim` at an NFS-backed share and create one static PV
per target namespace against the same NFS export/path — `ensureExportPVC`
will find the existing claim and leave it alone rather than creating a second
one.
