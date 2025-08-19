# Harvester VM Import UI Add-on

This add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.

# Features
* Manage vCenter sources directly from the UI (Create/Delete).
* Select a pre-configured vCenter source to browse its inventory.
* Manage plans: See details or delete with confirmation.
* Map source vCenter networks to target Harvester VLANs.
* Select a target Harvester Namespace and StorageClass for imported VMs.
# Prerequisites (CRITICAL)
Before using the UI to create a migration plan, you must first create a vCenter Source. You can do this from the "vCenter Sources" tab in the UI itself. This will create the necessary Secret and VmwareSource resources in your Harvester cluster.Alternatively, you can create them manually:

1. Create the Credentials Secret

Create a file named vsphere-secret.yaml with your vCenter username and password.
```
apiVersion: v1
kind: Secret
metadata:
  name: vsphere-credentials
  namespace: default
stringData:
  "username": "your-vcenter-user"
  "password": "your-vcenter-password"
```

Apply it to your cluster: 
```
kubectl apply -f vsphere-secret.yaml
```
2. Create the VmwareSource
Create a file named vmware-source.yaml. This resource tells the import controller how to connect to your vCenter.
```
apiVersion: migration.harvesterhci.io/v1beta1
kind: VmwareSource
metadata:
  name: my-vcenter
  namespace: default
spec:
  endpoint: "https://your-vcenter-address/sdk"
  dc: "Your-Datacenter-Name" # The name of the Datacenter in vCenter
  credentials:
    name: vsphere-credentials
    namespace: default
```

Apply it to your cluster: 
```
kubectl apply -f vmware-source.yaml
```

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

