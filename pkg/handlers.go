// pkg/handlers.go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
)


var (
	vmiGVR = schema.GroupVersionResource{
		Group:    "migration.harvesterhci.io",
		Version:  "v1beta1",
		Resource: "virtualmachineimports",
	}
	vmwareSourceGVR = schema.GroupVersionResource{
		Group:    "migration.harvesterhci.io",
		Version:  "v1beta1",
		Resource: "vmwaresources",
	}
	vmGVR = schema.GroupVersionResource{
		Group:    "kubevirt.io",
		Version:  "v1",
		Resource: "virtualmachines",
	}
	// NEW: To check cluster version
	settingsGVR = schema.GroupVersionResource{
		Group:    "harvesterhci.io",
		Version:  "v1beta1",
		Resource: "settings",
	}
)

// Helper to respond with JSON
func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, _ := json.Marshal(payload)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
}

// Helper to respond with a JSON error
func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
}

// NEW: Capability configuration to send to frontend
type CapabilityConfig struct {
	HarvesterVersion string `json:"harvesterVersion"`
	HasAdvancedPower bool   `json:"hasAdvancedPower"` // v1.6.0+
}

// NEW: Handler to check Harvester version and features
func GetCapabilitiesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		// 1. Fetch the 'server-version' setting
		setting, err := clients.Dynamic.Resource(settingsGVR).Get(context.TODO(), "server-version", metav1.GetOptions{})
		if err != nil {
			// If we fail to check (e.g., permissions or very old cluster), assume old version
			log.Warnf("Could not determine Harvester version: %v", err)
			respondWithJSON(w, http.StatusOK, CapabilityConfig{HarvesterVersion: "unknown", HasAdvancedPower: false})
			return
		}

		// 2. Extract the value
		version, _, _ := unstructured.NestedString(setting.Object, "value")

		// 3. Check logic: Is this v1.6.0 or newer?
		// Simple check looks for "v1.6", "v1.7", "master" or newer versions.
		hasAdvanced := strings.Contains(version, "v1.6") ||
			strings.Contains(version, "v1.7") ||
			strings.Contains(version, "v1.8") ||
			strings.Contains(version, "v1.9") ||
			strings.Contains(version, "master")

		respondWithJSON(w, http.StatusOK, CapabilityConfig{
			HarvesterVersion: version,
			HasAdvancedPower: hasAdvanced,
		})
	}
}

type VCenterCredentials struct {
	URL      string
	Username string
	Password string
}

func HandleGetInventory(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching inventory for VmwareSource %s/%s", namespace, name)

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}

		endpoint, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "endpoint")

		secretName, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "credentials", "name")
		secretNamespace, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "credentials", "namespace")

		secret, err := clients.Clientset.CoreV1().Secrets(secretNamespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get credentials secret: "+err.Error())
			return
		}

		creds := VCenterCredentials{
			URL:      endpoint,
			Username: string(secret.Data["username"]),
			Password: string(secret.Data["password"]),
		}

		inventory, err := GetVCenterInventory(r.Context(), creds)
		if err != nil {
			log.Errorf("Failed to get vCenter inventory: %v", err)
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, inventory)
	}
}

func CreatePlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var plan VirtualMachineImport
		if err := json.NewDecoder(r.Body).Decode(&plan); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Creating VirtualMachineImport CR: %s in namespace %s", plan.Name, plan.Namespace)
		log.Debugf("Received plan payload: %+v", plan)

		unstructuredObj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&plan)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to convert plan to unstructured object: "+err.Error())
			return
		}

		createdObj, err := clients.Dynamic.Resource(vmiGVR).Namespace(plan.Namespace).Create(context.TODO(), &unstructured.Unstructured{Object: unstructuredObj}, metav1.CreateOptions{})
		if err != nil {
			log.Errorf("Failed to create VirtualMachineImport CR: %v", err)
			respondWithError(w, http.StatusInternalServerError, "Failed to create VirtualMachineImport CR: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

func ListPlansHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(vmiGVR).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VirtualMachineImport CRs: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

func DeletePlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Deleting VirtualMachineImport CR: %s in namespace %s", name, namespace)
		err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func RunPlanHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Triggering 'Run Now' for VirtualMachineImport CR: %s in namespace %s", name, namespace)

		item, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		unstructured.RemoveNestedField(item.Object, "spec", "schedule")

		updatedItem, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Update(context.TODO(), item, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedItem)
	}
}

func ListVmwareSourcesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := clients.Dynamic.Resource(vmwareSourceGVR).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VmwareSource CRs: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

type CreateVmwareSourcePayload struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Endpoint   string `json:"endpoint"`
	Datacenter string `json:"datacenter"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

func CreateVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload CreateVmwareSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		// 1. Create the Secret
		secretName := payload.Name + "-credentials"
		secret := &v1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: payload.Namespace,
			},
			StringData: map[string]string{
				"username": payload.Username,
				"password": payload.Password,
			},
		}
		_, err := clients.Clientset.CoreV1().Secrets(payload.Namespace).Create(context.TODO(), secret, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to create credentials secret: "+err.Error())
			return
		}

		// 2. Create the VmwareSource
		vmwareSource := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "migration.harvesterhci.io/v1beta1",
				"kind":       "VmwareSource",
				"metadata": map[string]interface{}{
					"name":      payload.Name,
					"namespace": payload.Namespace,
				},
				"spec": map[string]interface{}{
					"endpoint": payload.Endpoint,
					"dc":       payload.Datacenter,
					"credentials": map[string]interface{}{
						"name":      secretName,
						"namespace": payload.Namespace,
					},
				},
			},
		}

		createdObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(payload.Namespace).Create(context.TODO(), vmwareSource, metav1.CreateOptions{})
		if err != nil {
			// Clean up the secret if source creation fails
			_ = clients.Clientset.CoreV1().Secrets(payload.Namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{})
			respondWithError(w, http.StatusInternalServerError, "Failed to create VmwareSource CR: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, createdObj)
	}
}

func GetVmwareSourceDetails(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get VmwareSource: "+err.Error())
			return
		}

		secretName, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "credentials", "name")
		secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
			return
		}

		sourceObj.Object["spec"].(map[string]interface{})["username"] = string(secret.Data["username"])

		respondWithJSON(w, http.StatusOK, sourceObj)
	}
}

func UpdateVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		var payload CreateVmwareSourcePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		// 1. Get the existing VmwareSource to find the secret name
		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusNotFound, "Failed to get VmwareSource: "+err.Error())
			return
		}
		secretName, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "credentials", "name")

		// 2. Update the Secret, only if new credentials are provided
		if payload.Username != "" || payload.Password != "" {
			secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(context.TODO(), secretName, metav1.GetOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to get associated secret: "+err.Error())
				return
			}

			if secret.StringData == nil {
				secret.StringData = make(map[string]string)
			}

			if payload.Username != "" {
				secret.StringData["username"] = payload.Username
			}
			if payload.Password != "" {
				secret.StringData["password"] = payload.Password
			}
			_, err = clients.Clientset.CoreV1().Secrets(namespace).Update(context.TODO(), secret, metav1.UpdateOptions{})
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "Failed to update secret: "+err.Error())
				return
			}
		}

		// 3. Update the VmwareSource
		unstructured.SetNestedField(sourceObj.Object, payload.Endpoint, "spec", "endpoint")
		unstructured.SetNestedField(sourceObj.Object, payload.Datacenter, "spec", "dc")

		updatedObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Update(context.TODO(), sourceObj, metav1.UpdateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to update VmwareSource: "+err.Error())
			return
		}

		respondWithJSON(w, http.StatusOK, updatedObj)
	}
}

func DeleteVmwareSourceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		// 1. Get the VmwareSource to find the associated secret
		sourceObj, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get VmwareSource: "+err.Error())
			return
		}
		secretName, _, _ := unstructured.NestedString(sourceObj.Object, "spec", "credentials", "name")

		// 2. Delete the VmwareSource
		err = clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Delete(context.TODO(), name, metav1.DeleteOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to delete VmwareSource: "+err.Error())
			return
		}

		// 3. Delete the associated Secret
		if secretName != "" {
			err = clients.Clientset.CoreV1().Secrets(namespace).Delete(context.TODO(), secretName, metav1.DeleteOptions{})
			if err != nil {
				// Log the error but don't fail the request, as the primary resource was deleted.
				log.Warnf("Failed to delete associated secret %s/%s: %v", namespace, secretName, err)
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func ListNamespacesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		namespaces, err := clients.Clientset.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, namespaces.Items)
	}
}

func CreateNamespaceHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		log.Infof("Creating namespace: %s", payload.Name)
		nsSpec := &v1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: payload.Name}}
		_, err := clients.Clientset.CoreV1().Namespaces().Create(context.TODO(), nsSpec, metav1.CreateOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		respondWithJSON(w, http.StatusCreated, map[string]string{"status": "namespace created"})
	}
}

func ListVlanConfigsHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info("Listing Harvester VlanConfigs")
		gvr := schema.GroupVersionResource{
			Group:    "k8s.cni.cncf.io",
			Version:  "v1",
			Resource: "network-attachment-definitions",
		}

		listOptions := metav1.ListOptions{
			LabelSelector: "network.harvesterhci.io/type=L2VlanNetwork",
		}

		list, err := clients.Dynamic.Resource(gvr).Namespace("").List(context.TODO(), listOptions)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		log.Debugf("Fetched VLAN definitions: %+v", list.Items)
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}

func ListStorageClassesHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scs, err := clients.Clientset.StorageV1().StorageClasses().List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, scs.Items)
	}
}

func HandleGetPlanLogs(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching logs related to plan %s/%s", namespace, name)

		// 1. Get the plan to find its source
		planObj, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to get plan: "+err.Error())
			return
		}
		sourceName, _, _ := unstructured.NestedString(planObj.Object, "spec", "sourceCluster", "name")
		sourceNamespace, _, _ := unstructured.NestedString(planObj.Object, "spec", "sourceCluster", "namespace")

		// 2. Find the controller pod
		pods, err := clients.Clientset.CoreV1().Pods("harvester-system").List(context.TODO(), metav1.ListOptions{
			LabelSelector: "app.kubernetes.io/name=harvester-vm-import-controller",
		})
		if err != nil || len(pods.Items) == 0 {
			respondWithError(w, http.StatusInternalServerError, "Could not find vm-import-controller pod")
			return
		}
		podName := pods.Items[0].Name

		// 3. Fetch logs from the pod
		req := clients.Clientset.CoreV1().Pods("harvester-system").GetLogs(podName, &v1.PodLogOptions{})
		podLogs, err := req.Stream(context.TODO())
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to stream pod logs: "+err.Error())
			return
		}
		defer podLogs.Close()

		// 4. Filter logs for the specific plan and its source
		var relevantLogs strings.Builder
		scanner := bufio.NewScanner(podLogs)
		planSearchString := fmt.Sprintf("'%s/%s'", namespace, name)
		sourceSearchString := fmt.Sprintf("'%s/%s'", sourceNamespace, sourceName)

		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, planSearchString) || strings.Contains(line, sourceSearchString) {
				relevantLogs.WriteString(line + "\n")
			}
		}

		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(relevantLogs.String()))
	}
}

func HandleGetPlanYAML(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching YAML for plan %s/%s", namespace, name)

		item, err := clients.Dynamic.Resource(vmiGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Convert unstructured object to YAML
		yamlBytes, err := yaml.Marshal(item.Object)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to marshal plan to YAML: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/yaml")
		w.WriteHeader(http.StatusOK)
		w.Write(yamlBytes)
	}
}

func HandleGetSourceYAML(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		name := vars["name"]

		log.Infof("Fetching YAML for source %s/%s", namespace, name)

		item, err := clients.Dynamic.Resource(vmwareSourceGVR).Namespace(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}

		yamlBytes, err := yaml.Marshal(item.Object)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to marshal source to YAML: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/yaml")
		w.WriteHeader(http.StatusOK)
		w.Write(yamlBytes)
	}
}

func ListVMsHandler(clients *K8sClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		list, err := clients.Dynamic.Resource(vmGVR).Namespace(namespace).List(context.TODO(), metav1.ListOptions{})
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "Failed to list VirtualMachines: "+err.Error())
			return
		}
		respondWithJSON(w, http.StatusOK, list.Items)
	}
}
