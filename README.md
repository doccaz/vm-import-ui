# Harvester VM Import UI

This add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.

# Features
* Manage vCenter sources directly from the UI (Create/Delete).
* Select a pre-configured vCenter source to browse its inventory.
* Manage plans: See details or delete with confirmation.
* Map source vCenter networks to target Harvester VLANs.
* Select a target Harvester Namespace and StorageClass for imported VMs.


# Quick Start (TL;DR)

1. Find the Kubeconfig file for your Harvester/SUSE Virtualization cluster.
2. Pull and run the latest version indicating the Kubeconfig file (docker works too):
```
podman run -p 8080:8080 \
  -v ~/mycluster-config:/kubeconfig:ro \
  -e KUBECONFIG=/kubeconfig \
  -e LOG_LEVEL=debug \
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
  -v ~/.kube/config:/kubeconfig:ro \
  -e KUBECONFIG=/kubeconfig \
  -e LOG_LEVEL=debug \
  vm-import-ui:local
```


