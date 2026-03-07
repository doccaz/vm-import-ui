# Harvester VM Import UI

This add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.

# Features
* **Multi-Source Support**: Import from VMware vCenter or flat OVA files.
* **Source Explorer**:
    * Browse vCenter inventory directly.
    * Perform VM operations (Power On/Off/Reboot, Rename) before migration.
    * View and **edit VM MAC addresses** for the source VM via API.
    * View and **edit VM Name** for the source VM via API.
* **Smart Migration Plans**:
    * Automated mapping of networks and storage.
    * **Annotations Tracking**: Original VM characteristics (CPU, Memory, Disks) are saved for transparency.
    * **Resource Comparison**: Easily compare source VM characteristics with current import status.
* **Streamlined Debugging**:
    * Integrated log viewer for the VM Import Controller.
    * Toggle between full controller logs or **filtered logs** relevant to your specific plan.
* **Management**: Monitor progress, view YAML, and delete plans with safety confirmations.

# Latest Release (v1.6.0)
The latest version includes enhanced UI spacing, Kubernetes-compliant plan name validation, and more robust VM metadata tracking.


# Quick Start (TL;DR)

1. Find the Kubeconfig file for your Harvester/SUSE Virtualization cluster (click on "Support" at the lower left on UI).
2. Pull and run the latest version indicating the Kubeconfig file (docker works too):
```
podman run -p 8080:8080 \
  -v ~/myharvester-kubeconfig:/kubeconfig:ro \
  ghcr.io/doccaz/vm-import-ui:latest
```
3. Open your browser at http://localhost:8080
4. Create a vCenter Source with your credentials
5. Create a Migration Plan and select a VM to migrate from the inventory.
6. Check the progress, wait a bit... you're done!

# Screenshots

Access the UI: open your web browser and navigate to http://localhost:8080.
![Create the VMware source configuration](screenshots/1-create-source.png)

Select the Source VM from the inventory:
![Select the source VM](screenshots/2-select-vm.png)

Configure the destination VM:
![Configure the destination VM](screenshots/3-config-vms.png)

Select the destination namespace:
![Configure the destination namespace for the imported VM](screenshots/3-config-vm.png)

Map the source and destionation networks for the imported VM:
![Map the source and destination networks for the imported VM](screenshots/4-map-vlans.png)

A summary will be shown with the actions that will be taken:
![Summary of what will be done](screenshots/5-summary.png)

The VM Import Controller objects and created, and the migration process is submitted:
![The migration starts](screenshots/6-migration-start.png)

The migration process is monitored:
![Migration progress](screenshots/7-migration-progress.png)

And... the VM is created in Harvester!
![Migration finished](screenshots/8-migration-finished.png)


# Building Locally and Testing

Step 1: Build the Container ImageFrom the project's root directory, build the image using Podman or Docker.

Using Podman
```
podman build -t vm-import-ui:local .
```

Step 2: Run the Container

Run the container, mapping port 8080 and mounting your local kubeconfig file.

Using Podman
```
podman run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e KUBECONFIG=/kubeconfig vm-import-ui:local
```

Step 3: Enabling Debugging

To see verbose logs from the backend, set the LOG_LEVEL environment variable.

Using Podman
```
podman run -p 8080:8080 \
  -v ~/myharvester-kubeconfig:/kubeconfig:ro \
  -e LOG_LEVEL=debug \
  vm-import-ui:local
```

# Workarounds

In one case, the VSphere host (with a .lan domain) was not being correctly resolved by podman's internal DNS. You can overrride the internal resolv.conf to point to your own DNS like this:

```
podman run -p 8080:8080 \
  -v ~/myharvester-kubeconfig:/kubeconfig:ro \
  -v /etc/resolv.conf:/etc/resolv.conf:ro \
  ghcr.io/doccaz/vm-import-ui:latest
```

