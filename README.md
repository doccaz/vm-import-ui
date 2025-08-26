# Harvester VM Import UI

This add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.

# Features
* Manage vCenter sources directly from the UI (Create/Delete).
* Select a pre-configured vCenter source to browse its inventory.
* Manage plans: See details or delete with confirmation.
* Map source vCenter networks to target Harvester VLANs.
* Select a target Harvester Namespace and StorageClass for imported VMs.
# Building and Testing

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

Step 4: Access the UI

Open your web browser and navigate to http://localhost:8080.
![Create the VMware source configuration](screenshots/1-create-source.png)

![Select the source VM](screenshots/2-select-vm.png)

![Configure the destination VM](screenshots/3-config-vms.png)

![Configure the destination namespace for the imported VM](screenshots/3-config-vm.png)

![Map the source and destination networks for the imported VM](screenshots/4-map-vlans.png)

![Summary of what will be done](screenshots/5-summary.png)

![The migration starts](screenshots/6-migration-start.png)

![Migration progress](screenshots/7-migration-progress.png)

![Migration finished](screenshots/6-migration-finished.png)
