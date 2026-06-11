# Harvester VM Import UI

A web interface for importing virtual machines from VMware vCenter into
**Harvester / SUSE Virtualization** clusters. It drives both migration engines:

- **VM Import Controller** — the native Harvester engine (`migration.harvesterhci.io`)
- **Forklift / Konveyor MTV** — the Migration Toolkit for Virtualization (`forklift.konveyor.io`)

Browse vCenter inventory, map source networks and datastores to Harvester
networks and storage classes, and run + monitor migrations from one place.

## What this chart installs

- A **Deployment** of the UI (authenticates to the cluster with its own ServiceAccount)
- A **NodePort Service** (default port `32000`) to reach the UI
- A **ClusterRole + binding** granting read/write to the resources the app manages
- An optional **Rancher NavLink** so the UI appears directly in the Rancher / Harvester menu

After installing, open the URL printed in the install notes (or use the menu link),
then create a vCenter Source / Forklift Provider and start a Migration Plan.
