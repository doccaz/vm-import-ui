# Harvester VM Import UI Add-on
This add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.

# Features
* Browse vCenter inventory (Datacenters, Clusters, Folders, VMs).
* Select multiple VMs for migration.
* Create migration plans to run immediately or schedule for later.
* Map source vCenter networks to target Harvester VLANs.
* Select a target Harvester Namespace and StorageClass for imported VMs.
* (Coming Soon) Progress indicators for migration tasks.

# Building and Testing
You can build and test this add-on both locally for development and by deploying it to a live Harvester cluster.

Prerequisites
* Go (version 1.21+)
* Node.js (version 18+) and Yarn
* Podman or Docker
* Access to a Kubernetes cluster (a Harvester cluster is required for full functionality).

A configured kubeconfig file (~/.kube/config) for local testing.

1. Local Development and Testing
Running the add-on locally is the fastest way to test UI changes. The backend can either connect to your real cluster using your local kubeconfig or run with mock data.

Step 1: Build the Container Image
From the project's root directory, build the image using Podman or Docker.

# Using Podman
```
podman build -t vm-import-ui:local .
```

# OR Using Docker
```
docker build -t vm-import-ui:local .
```

Step 2: Run the Container
Run the container, mapping port 8080 and mounting your local kubeconfig file.

# Using Podman
```
podman run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e KUBECONFIG=/kubeconfig vm-import-ui:local
```

# OR Using Docker
```
docker run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e KUBECONFIG=/kubeconfig vm-import-ui:local
```
The :ro flag mounts the kubeconfig as read-only for better security.

Step 3: Enabling Debugging and Mock Data
You can control the backend's behavior with environment variables:

Enable Verbose Logging: To see the full data payloads from vCenter and Harvester in the container logs, set the LOG_LEVEL to debug.

Use Mock Data: To test the UI without a live connection, set USE_MOCK_DATA to true.

Example (running with debug logging):

# Using Podman
```
podman run -p 8080:8080 \
  -v ~/.kube/config:/kubeconfig:ro \
  -e KUBECONFIG=/kubeconfig \
  -e LOG_LEVEL=debug \
  vm-import-ui:local
```

Step 4: Access the UI
Open your web browser and navigate to http://localhost:8080.

2. Deploying to a Harvester Cluster
To test the add-on in a real production environment, you need to push the image to a registry and install it in Harvester.

Step 1: Push the Image to a Registry
Tag your locally built image and push it to a container registry that your Harvester cluster can access.

# Using Podman or Docker

```
podman tag vm-import-ui:local your-registry.com/your-repo/vm-import-ui:0.4.6
podman push your-registry.com/your-repo/vm-import-ui:0.4.6
```

Step 2: Update the Deployment YAML
In the package/install.yaml file, find the Deployment resource and update the image field.

# In package/install.yaml
```
...
      containers:
      - name: vm-import-ui
        image: your-registry.com/your-repo/vm-import-ui:0.4.6 # <-- UPDATE THIS LINE
...
```

Step 3: Install the Add-on in Harvester
Follow the official Harvester documentation for managing add-ons to install your custom add-on.