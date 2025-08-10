Harvester VM Import UI Add-onThis add-on provides a user-friendly web interface for the Harvester VM Import Controller, allowing users to import virtual machines from vCenter into Harvester through a simple, wizard-driven process.FeaturesBrowse vCenter inventory (Datacenters, Clusters, Folders, VMs).Select multiple VMs for migration.Create migration plans to run immediately or schedule for later.Map source vCenter networks to target Harvester VLANs.Select a target Harvester Namespace and StorageClass for imported VMs.(Coming Soon) Progress indicators for migration tasks.Building and TestingYou can build and test this add-on both locally for development and by deploying it to a live Harvester cluster.PrerequisitesGo (version 1.20+)Node.js (version 18+) and YarnPodman or DockerAccess to a Kubernetes cluster (a Harvester cluster is required for full functionality).A configured kubeconfig file (~/.kube/config) for local testing.1. Local Development and TestingRunning the add-on locally is the fastest way to test UI changes. The backend will connect to your cluster using your local kubeconfig.Step 1: Build the Container ImageFrom the project's root directory, build the image using Podman or Docker.# Using Podman
podman build -t vm-import-ui:local .

# OR Using Docker
docker build -t vm-import-ui:local .
Step 2: Run the ContainerRun the container, mapping port 8080 and mounting your local kubeconfig file so the backend can connect to your Harvester cluster.# Using Podman
podman run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e KUBECONFIG=/kubeconfig vm-import-ui:local

# OR Using Docker
docker run -p 8080:8080 -v ~/.kube/config:/kubeconfig:ro -e KUBECONFIG=/kubeconfig vm-import-ui:local
The :ro flag mounts the kubeconfig as read-only for better security.Step 3: Access the UIOpen your web browser and navigate to http://localhost:8080.You should see the UI, and the dropdowns in the creation wizard should be populated with live data from your cluster.2. Deploying to a Harvester ClusterTo test the add-on in a real production environment, you need to push the image to a registry and install it in Harvester.Step 1: Push the Image to a RegistryTag your locally built image and push it to a container registry that your Harvester cluster can access (e.g., Docker Hub, Quay, etc.).# Using Podman or Docker
podman tag vm-import-ui:local your-registry.com/your-repo/vm-import-ui:0.2.8
podman push your-registry.com/your-repo/vm-import-ui:0.2.8
Step 2: Update the Deployment YAMLIn the package/install.yaml file, find the Deployment resource and update the image field to point to the image you just pushed.# In package/install.yaml
...
      containers:
      - name: vm-import-ui
        image: your-registry.com/your-repo/vm-import-ui:0.2.8 # <-- UPDATE THIS LINE
...
Step 3: Install the Add-on in HarvesterFollow the official Harvester documentation for managing add-ons to install your custom add-on.Once installed, Harvester will deploy the resources from install.yaml, and the add-on will appear in the Harvester UI, fully integrated.